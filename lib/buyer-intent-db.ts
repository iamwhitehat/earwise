// Server gate: keep only ON-NICHE GENUINE BUYERS. Combines buyer-intent (a real
// person seeking/willing to pay) with relevance (on the founder's niche), in one
// Haiku pass, caching both verdicts on the posts/post_comments rows. Tolerant of
// unmigrated columns (degrades to buyer-only, then to pass-through) and bounded
// so a load never fans out into unbounded Claude/embeddings calls.
import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { classifySignalGate } from './claude'
import { isGenuineBuyer, buildNicheContext, nicheKey, type BuyerVerdict } from './buyer-intent'
import { getProject } from './projects-db'
import { loadMemoryFacts } from './memory-db'
import { fitText, offerText, DEFAULT_PROJECT } from './memory'
import { isEmbeddingsConfigured, embedTexts, cosineSimilarity } from './embeddings'
import type { SignalRow } from './signals-db'

// Max uncached signals processed per request; the rest pass through and get
// caught on a later load.
const CLASSIFY_CAP = 60
// Cosine below this against the niche = clearly off-niche → skip the Claude call.
// Conservative on purpose: Haiku remains the authority for anything borderline.
const REL_MIN_COSINE = 0.12

const keyOf = (s: Pick<SignalRow, 'kind' | 'id'>): string => `${s.kind}:${s.id}`

function isBuyerVerdict(v: unknown): v is BuyerVerdict {
  return v === 'buyer' || v === 'not_buyer'
}

/** The founder's niche context (project niche + business memory) and its key. */
async function loadNiche(db: SupabaseClient, projectId: string): Promise<{ context: string; key: string }> {
  let context = ''
  try {
    const [project, facts] = await Promise.all([getProject(db, projectId), loadMemoryFacts(db, projectId)])
    context = buildNicheContext([project?.niche, fitText(facts), offerText(facts)])
  } catch {
    /* tolerant — no niche → relevance simply isn't applied */
  }
  return { context, key: nicheKey(context) }
}

/**
 * Keep only on-niche genuine buyers. Confirmed non-buyers and confirmed
 * off-niche signals are dropped; anything not yet judged passes through so a
 * real lead is never hidden before it's been screened.
 */
export async function gateSignals(
  db: SupabaseClient,
  signals: SignalRow[],
  opts: { projectId?: string; classifyCap?: number } = {},
): Promise<SignalRow[]> {
  if (signals.length === 0) return signals
  const projectId = opts.projectId ?? DEFAULT_PROJECT
  const { context: niche, key: nKey } = await loadNiche(db, projectId)
  const relevanceWanted = niche.length > 0

  const buyer = new Map<string, BuyerVerdict>()
  const onNiche = new Map<string, boolean>()
  let relevanceAvailable = relevanceWanted

  // 1. Cached reads. Try buyer + relevance columns; fall back to buyer-only when
  // the relevance columns aren't migrated; pass-through if buyer cols missing too.
  async function readCache(table: 'posts' | 'post_comments', idCol: string, ids: string[], prefix: string): Promise<boolean> {
    if (ids.length === 0) return true
    const full = await db.from(table).select(`${idCol}, buyer_intent, on_niche, niche_key`).in(idCol, ids)
    let rows: Record<string, unknown>[]
    if (full.error) {
      relevanceAvailable = false
      const basic = await db.from(table).select(`${idCol}, buyer_intent`).in(idCol, ids)
      if (basic.error) return false
      rows = (basic.data ?? []) as unknown as Record<string, unknown>[]
    } else {
      rows = (full.data ?? []) as unknown as Record<string, unknown>[]
    }
    for (const row of rows) {
      const id = row[idCol] as string
      if (isBuyerVerdict(row.buyer_intent)) buyer.set(`${prefix}:${id}`, row.buyer_intent)
      if (relevanceAvailable && typeof row.on_niche === 'boolean' && row.niche_key === nKey) {
        onNiche.set(`${prefix}:${id}`, row.on_niche as boolean)
      }
    }
    return true
  }

  const postIds = signals.filter((s) => s.kind === 'post').map((s) => s.id)
  const commentIds = signals.filter((s) => s.kind === 'comment').map((s) => s.id)
  const okPosts = await readCache('posts', 'post_id', postIds, 'post')
  const okComments = await readCache('post_comments', 'comment_id', commentIds, 'comment')
  if (!okPosts || !okComments) return signals // buyer columns absent → pass-through

  const relevanceActive = relevanceWanted && relevanceAvailable

  // 2. Find what still needs judging: missing buyer verdict, or (when relevance
  // is active) missing a current-niche on-niche verdict.
  const uncached = signals
    .filter((s) => {
      const k = keyOf(s)
      return !buyer.has(k) || (relevanceActive && !onNiche.has(k))
    })
    .slice(0, opts.classifyCap ?? CLASSIFY_CAP)

  if (uncached.length > 0) {
    const nowIso = new Date().toISOString()
    const writes: Promise<unknown>[] = []
    const persist = (s: SignalRow, patch: Record<string, unknown>) => {
      writes.push(
        s.kind === 'post'
          ? Promise.resolve(db.from('posts').update(patch).eq('post_id', s.id).eq('subreddit', s.subreddit))
          : Promise.resolve(db.from('post_comments').update(patch).eq('comment_id', s.id)),
      )
    }

    // 2a. Optional embeddings pre-screen — cheaply drop clearly off-niche items
    // before the Claude call. Conservative threshold; Claude judges the rest.
    let toClassify = uncached
    if (relevanceActive && isEmbeddingsConfigured()) {
      const vecs = await embedTexts([niche, ...uncached.map((s) => s.text.slice(0, 600))])
      if (vecs && vecs.length === uncached.length + 1) {
        const [nicheVec, ...itemVecs] = vecs
        const kept: SignalRow[] = []
        uncached.forEach((s, i) => {
          if (cosineSimilarity(nicheVec, itemVecs[i]) < REL_MIN_COSINE) {
            onNiche.set(keyOf(s), false)
            persist(s, { on_niche: false, niche_key: nKey, on_niche_at: nowIso })
          } else {
            kept.push(s)
          }
        })
        toClassify = kept
      }
    }

    // 2b. Haiku: the authoritative combined verdict for what's left.
    if (toClassify.length > 0) {
      const results = await classifySignalGate(toClassify.map((s) => ({ text: s.text })), niche)
      toClassify.forEach((s, i) => {
        const r = results[i]
        if (!r) return
        buyer.set(keyOf(s), r.buyer)
        const patch: Record<string, unknown> = { buyer_intent: r.buyer, buyer_intent_at: nowIso }
        if (relevanceActive) {
          onNiche.set(keyOf(s), r.onNiche)
          patch.on_niche = r.onNiche
          patch.niche_key = nKey
          patch.on_niche_at = nowIso
        }
        persist(s, patch)
      })
    }

    if (writes.length > 0) {
      try {
        await Promise.all(writes)
      } catch (err) {
        console.warn('[signal-gate] persist skipped:', err)
      }
    }
  }

  // 3. Drop confirmed non-buyers + confirmed off-niche; keep buyers + unjudged.
  return signals.filter((s) => {
    const k = keyOf(s)
    const b = buyer.get(k)
    if (b != null && !isGenuineBuyer(b)) return false
    if (relevanceActive && onNiche.get(k) === false) return false
    return true
  })
}
