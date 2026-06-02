// Server-side relevance / ICP gate. For the ACTIVE project, scores each signal
// by "is this on my niche AND is the author a potential customer for my
// product?" — the primary path is embedding cosine to a project-niche vector
// (cached on posts.embedding), with a cheap Haiku yes/no fallback when no
// embeddings key is configured. Project-scoped and computed at query time; the
// score is NEVER baked onto the post as a single global value. Tolerant of an
// unmigrated embedding column / absent tables (degrades to "relevant" so a real
// lead is never hidden before it can be screened). Bounded by RELEVANCE_CAP.
import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { isEmbeddingsConfigured, embedTexts, cosineSimilarity } from './embeddings'
import { classifyRelevance } from './claude'
import {
  buildNicheText,
  relevanceFromCosine,
  relevanceFromVerdict,
  type Relevance,
} from './relevance'
import { getProject } from './projects-db'
import { loadMemoryFacts } from './memory-db'
import { offerText, fitText, DEFAULT_PROJECT } from './memory'
import { canonicalTopic } from './topics'
import type { SignalRow } from './signals-db'

const RELEVANCE_CAP = 80
const EMBED_TEXT_CAP = 600
const FULLY_RELEVANT: Relevance = { score: 1, reason: 'not screened' }

export const keyOf = (s: Pick<SignalRow, 'kind' | 'id'>): string => `${s.kind}:${s.id}`

/** Top opportunity topics (canonical) for a project — enriches the niche vector
 *  with what the project is actually pursuing. [] when the table is absent. */
async function topOpportunityTopics(db: SupabaseClient, projectId: string): Promise<string[]> {
  const { data, error } = await db
    .from('opportunities')
    .select('canonical_topic')
    .eq('project_id', projectId)
    .order('advantage_score', { ascending: false })
    .limit(12)
  if (error) return []
  const topics: string[] = []
  for (const r of (data ?? []) as Array<{ canonical_topic?: unknown }>) {
    const t = canonicalTopic(typeof r.canonical_topic === 'string' ? r.canonical_topic : null)
    if (t) topics.push(t)
  }
  return topics
}

/** Build the niche text for a project from its niche + product/value-prop/ICP +
 *  top opportunity topics. '' when there's nothing to anchor relevance on. */
export async function loadNicheText(
  db: SupabaseClient,
  projectId: string = DEFAULT_PROJECT,
): Promise<string> {
  try {
    const [project, facts, topics] = await Promise.all([
      getProject(db, projectId),
      loadMemoryFacts(db, projectId),
      topOpportunityTopics(db, projectId),
    ])
    return buildNicheText([
      project?.niche,
      offerText(facts),
      fitText(facts),
      topics.length ? `Topics: ${topics.join(', ')}` : '',
    ])
  } catch (err) {
    console.warn('[relevance] loadNicheText failed:', err)
    return ''
  }
}

// ── per-signal relevance ─────────────────────────────────────────────────────

/** Cached post embeddings keyed `post:<id>`. {} on an unmigrated column. */
async function readPostEmbeddings(db: SupabaseClient, postIds: string[]): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>()
  if (postIds.length === 0) return out
  const { data, error } = await db.from('posts').select('post_id, embedding').in('post_id', postIds)
  if (error) return out
  for (const r of (data ?? []) as unknown as Record<string, unknown>[]) {
    const emb = r.embedding
    if (Array.isArray(emb) && emb.every((n) => typeof n === 'number')) {
      out.set(`post:${r.post_id as string}`, emb as number[])
    }
  }
  return out
}

/** Embedding-cosine path. Returns null when the embed call is unavailable so
 *  the caller can fall back to Haiku. */
async function viaEmbeddings(
  db: SupabaseClient,
  nicheText: string,
  batch: SignalRow[],
): Promise<Map<string, Relevance> | null> {
  const cached = await readPostEmbeddings(db, batch.filter((s) => s.kind === 'post').map((s) => s.id))
  const need = batch.filter((s) => !cached.has(keyOf(s)))
  const vecs = await embedTexts([nicheText, ...need.map((s) => s.text.slice(0, EMBED_TEXT_CAP))])
  if (!vecs || vecs.length !== need.length + 1) return null
  const nicheVec = vecs[0]

  const newPostEmb: Array<{ s: SignalRow; emb: number[] }> = []
  need.forEach((s, i) => {
    const emb = vecs[i + 1]
    cached.set(keyOf(s), emb)
    if (s.kind === 'post') newPostEmb.push({ s, emb })
  })

  // Cache freshly-computed post embeddings (best-effort; ignored pre-migration).
  if (newPostEmb.length > 0) {
    try {
      await Promise.all(
        newPostEmb.map(({ s, emb }) =>
          Promise.resolve(
            db.from('posts').update({ embedding: emb }).eq('post_id', s.id).eq('subreddit', s.subreddit),
          ),
        ),
      )
    } catch (err) {
      console.warn('[relevance] embedding cache skipped:', err)
    }
  }

  const out = new Map<string, Relevance>()
  for (const s of batch) {
    const v = cached.get(keyOf(s))
    if (!v) {
      out.set(keyOf(s), FULLY_RELEVANT)
      continue
    }
    const cos = cosineSimilarity(nicheVec, v)
    out.set(keyOf(s), { score: relevanceFromCosine(cos), reason: `niche match ${Math.round(cos * 100)}%` })
  }
  return out
}

/** Cheap Haiku yes/no fallback (no embeddings key). */
async function viaHaiku(nicheText: string, batch: SignalRow[]): Promise<Map<string, Relevance>> {
  const out = new Map<string, Relevance>()
  const results = await classifyRelevance(batch.map((s) => ({ text: s.text })), nicheText)
  batch.forEach((s, i) => {
    const r = results[i]
    out.set(
      keyOf(s),
      r ? { score: relevanceFromVerdict(r.relevant), reason: r.reason || 'screened' } : FULLY_RELEVANT,
    )
  })
  return out
}

/**
 * Score each signal's relevance to the active project. Returns a map keyed by
 * `${kind}:${id}`. Unscored / over-cap / no-niche signals map to FULLY_RELEVANT
 * (score 1) so the buyer-intent gate still applies but relevance never hides a
 * lead it couldn't actually evaluate.
 */
export async function loadRelevance(
  db: SupabaseClient,
  signals: SignalRow[],
  projectId: string = DEFAULT_PROJECT,
): Promise<Map<string, Relevance>> {
  const out = new Map<string, Relevance>()
  if (signals.length === 0) return out

  const nicheText = await loadNicheText(db, projectId)
  if (!nicheText) {
    for (const s of signals) out.set(keyOf(s), FULLY_RELEVANT)
    return out
  }

  const batch = signals.slice(0, RELEVANCE_CAP)
  let scored: Map<string, Relevance> | null = null
  if (isEmbeddingsConfigured()) {
    try {
      scored = await viaEmbeddings(db, nicheText, batch)
    } catch (err) {
      console.warn('[relevance] embeddings path failed:', err)
      scored = null
    }
  }
  if (!scored) {
    try {
      scored = await viaHaiku(nicheText, batch)
    } catch (err) {
      console.warn('[relevance] haiku path failed:', err)
      scored = new Map()
    }
  }

  for (const s of signals) out.set(keyOf(s), scored.get(keyOf(s)) ?? FULLY_RELEVANT)
  return out
}
