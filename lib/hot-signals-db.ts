// Server orchestration for the hot-now feed: load recent high-intent signals,
// score them with ICP-fit from business memory, and rank. Reused by
// /api/hot-signals and the cron alert step. Pure ranking lives in lib/hot-signals.
import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { loadSignals } from './signals-db'
import { gateSignals } from './buyer-intent-db'
import { scoreSignal, rankHotSignals, type HotSignal } from './hot-signals'
import { computeFitToYou } from './advantage'
import { fitText, DEFAULT_PROJECT } from './memory'
import { loadMemoryFacts } from './memory-db'

export async function loadHotSignals(
  db: SupabaseClient,
  opts: { windowMs: number; projectId?: string; limit?: number; minScore?: number },
): Promise<HotSignal[]> {
  const projectId = opts.projectId ?? DEFAULT_PROJECT
  const [signals, memFacts] = await Promise.all([
    loadSignals(db, { ageMs: opts.windowMs }),
    loadMemoryFacts(db, projectId),
  ])
  // Relevance + buyer-intent gate before scoring so Hot-now only ever shows
  // on-niche genuine buyers.
  const gated = await gateSignals(db, signals, { projectId })
  const memText = fitText(memFacts)
  const scored = gated.map((s) =>
    scoreSignal(s, computeFitToYou(memText, `${s.topic ?? ''} ${s.text}`)),
  )
  return rankHotSignals(scored, { limit: opts.limit, minScore: opts.minScore })
}
