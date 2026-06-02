// Combined relevance + buyer-intent gate for a SINGLE candidate, shared by the
// lead-creation path (POST /api/leads) so off-niche / non-buyer signals never
// reach the leads table. The feed (lib/hot-signals-db) applies the same two
// filters in batch. Degrades open: when classification/embeddings are
// unavailable the candidate passes (we only block confident disqualifications).
import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { gateSignals } from './buyer-intent-db'
import { loadRelevance, relevanceTau, keyOf } from './relevance-db'
import type { SignalRow } from './signals-db'

export type GateResult = { ok: boolean; reason: string }

/** Qualify one signal: genuine buyer AND on-niche (relevance >= τ). */
export async function qualifySignal(
  db: SupabaseClient,
  signal: SignalRow,
  projectId: string,
): Promise<GateResult> {
  const buyers = await gateSignals(db, [signal], { projectId })
  if (buyers.length === 0) {
    return { ok: false, reason: 'not a genuine buyer (self-promo or discussion)' }
  }
  const relevance = await loadRelevance(db, buyers, projectId)
  const r = relevance.get(keyOf(signal)) ?? { score: 1, reason: '' }
  if (r.score < relevanceTau()) {
    return { ok: false, reason: `off-niche${r.reason ? ` (${r.reason})` : ''}` }
  }
  return { ok: true, reason: r.reason }
}
