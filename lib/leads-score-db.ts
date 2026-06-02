// Server glue for Lead Score: compute ICP-fit from business memory, score each
// lead, attach the fresh score/tier/breakdown, and lazily backfill the stored
// columns (best-effort, capped). Kept out of lib/lead-score.ts so that module
// stays pure/testable.
import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { computeFitToYou } from './advantage'
import { fitText, DEFAULT_PROJECT } from './memory'
import { loadMemoryFacts } from './memory-db'
import { scoreLead, type LeadScore } from './lead-score'
import { persistLeadScore } from './leads-db'
import { isEmbeddingsConfigured } from './embeddings'
import { loadRelevance, keyOf } from './relevance-db'
import type { Lead } from './leads'
import type { SignalRow } from './signals-db'
import type { IntentType } from './intent-patterns'
import type { Category } from './categories'

// How many stale/missing scores to persist per request, so a list load never
// fans out into hundreds of writes.
const BACKFILL_CAP = 50

/** Adapt a stored Lead back into a SignalRow so it can be re-scored for
 *  relevance against the active project, or re-run through the combined gate. */
export function leadToSignal(lead: Lead): SignalRow {
  const prefix = `${lead.kind}:`
  const id = lead.externalId.startsWith(prefix) ? lead.externalId.slice(prefix.length) : lead.postId
  return {
    kind: lead.kind,
    id,
    post_id: lead.postId,
    subreddit: lead.subreddit,
    author: lead.author,
    text: lead.excerpt,
    matchedPhrase: '',
    intentType: (lead.intentType as IntentType) ?? 'looking-for',
    category: (lead.category as Category) ?? 'other',
    topic: lead.topic,
    analyzedAt: lead.createdAt,
    permalink: lead.permalink,
  }
}

/** Pure scoring of one mapped lead given the memory fit-text + relevance.
 *  `relevance` is the lead's 0..1 fit to the active project (default 0.5). */
export function scoreOneLead(lead: Lead, memText: string, relevance?: number): LeadScore {
  const icpFit = computeFitToYou(memText, `${lead.topic ?? ''} ${lead.excerpt}`)
  return scoreLead({
    intentType: (lead.intentType as IntentType | null) ?? null,
    relevance: relevance ?? null,
    postedAt: lead.createdAt,
    icpFit,
    engagement: 0, // RSS leads have no upvote/comment data yet
  })
}

/**
 * Attach a freshly-computed score/tier/breakdown to each lead (authoritative),
 * and best-effort persist any whose stored value drifted/was missing. Returns
 * the enriched leads; never throws on a persistence failure.
 */
export async function scoreLeads(
  db: SupabaseClient,
  leads: Lead[],
  projectId: string = DEFAULT_PROJECT,
): Promise<Lead[]> {
  if (leads.length === 0) return leads
  const memText = fitText(await loadMemoryFacts(db, projectId))

  // Relevance via the embeddings cosine path only (cheap + cached on
  // posts.embedding) so a board load never fans out into Haiku calls. With no
  // embeddings key, relevance stays neutral (0.5) rather than slow the list.
  const sigs = leads.map(leadToSignal)
  const relevance = isEmbeddingsConfigured() ? await loadRelevance(db, sigs, projectId) : null

  const enriched: Lead[] = []
  const toPersist: { id: number; score: number; tier: string }[] = []
  leads.forEach((lead, i) => {
    const rel = relevance?.get(keyOf(sigs[i]))?.score
    const s = scoreOneLead(lead, memText, rel)
    enriched.push({ ...lead, leadScore: s.score, tier: s.tier, scoreBreakdown: s.breakdown })
    if (lead.leadScore !== s.score || lead.tier !== s.tier) {
      toPersist.push({ id: lead.id, score: s.score, tier: s.tier })
    }
  })

  for (const p of toPersist.slice(0, BACKFILL_CAP)) {
    await persistLeadScore(db, p.id, p.score, p.tier)
  }

  return enriched
}

/** hot → warm → cold, then by score desc. Used for the default "Hot first" sort. */
export function sortHotFirst(leads: Lead[]): Lead[] {
  return [...leads].sort((a, b) => (b.leadScore ?? -1) - (a.leadScore ?? -1))
}
