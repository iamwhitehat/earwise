// Server orchestration for the hot-now feed: load recent high-intent signals,
// score them with ICP-fit from business memory, and rank. Reused by
// /api/hot-signals and the cron alert step. Pure ranking lives in lib/hot-signals.
import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { loadSignals } from './signals-db'
import { gateSignals } from './buyer-intent-db'
import { loadRelevance, relevanceTau, keyOf } from './relevance-db'
import { scoreSignal, rankHotSignals, type HotSignal } from './hot-signals'
import { computeFitToYou } from './advantage'
import { fitText, DEFAULT_PROJECT } from './memory'
import { loadMemoryFacts } from './memory-db'

const HOUR_MS = 60 * 60 * 1000
const DEFAULT_HOT_NOW_HOURS = 6

/** HOT NOW window in hours (env-tunable HOT_NOW_WINDOW_HOURS, default 6).
 *  Tight by design so the lane shows fresh demand, not stale 20h rows. */
export function hotNowWindowHours(): number {
  const raw = Number(process.env.HOT_NOW_WINDOW_HOURS)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_HOT_NOW_HOURS
}

export function hotNowWindowMs(): number {
  return hotNowWindowHours() * HOUR_MS
}

/** Epoch ms of the most recent scan (newest analyzed post), for the "last scan
 *  {t}" empty state. null when nothing has been scanned / the table is absent. */
export async function lastScanAt(db: SupabaseClient): Promise<number | null> {
  const { data, error } = await db
    .from('posts')
    .select('analyzed_at')
    .order('analyzed_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data?.analyzed_at) return null
  return new Date(data.analyzed_at as string).getTime()
}

export async function loadHotSignals(
  db: SupabaseClient,
  opts: { windowMs: number; projectId?: string; limit?: number; minScore?: number },
): Promise<HotSignal[]> {
  const projectId = opts.projectId ?? DEFAULT_PROJECT
  const [signals, memFacts] = await Promise.all([
    loadSignals(db, { ageMs: opts.windowMs }),
    loadMemoryFacts(db, projectId),
  ])
  // Combined gate before scoring so Hot-now only ever shows on-niche genuine
  // buyers: (1) buyer-intent (drops makers/discussion), then (2) relevance to
  // the active project (drops off-niche), qualifying only relevance >= τ.
  const buyers = await gateSignals(db, signals, { projectId })
  const relevance = await loadRelevance(db, buyers, projectId)
  const tau = relevanceTau()
  const qualified = buyers.filter((s) => (relevance.get(keyOf(s))?.score ?? 1) >= tau)

  const memText = fitText(memFacts)
  const scored = qualified.map((s) =>
    scoreSignal(
      s,
      computeFitToYou(memText, `${s.topic ?? ''} ${s.text}`),
      relevance.get(keyOf(s))?.score ?? 1,
    ),
  )
  return rankHotSignals(scored, { limit: opts.limit, minScore: opts.minScore })
}
