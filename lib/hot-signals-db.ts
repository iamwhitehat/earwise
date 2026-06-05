// Server orchestration for the hot-now feed: load recent high-intent signals,
// score them with ICP-fit from business memory, and rank. Reused by
// /api/hot-signals and the cron alert step. Pure ranking lives in lib/hot-signals.
import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { loadSignals, loadIngestedSignals } from './signals-db'
import { mergeSignalsByPostId } from './signals-util'
import { gateSignals } from './buyer-intent-db'
import { loadRelevance, relevanceTau, keyOf, loadNicheText } from './relevance-db'
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

export type HotSignalsResult = {
  signals: HotSignal[]
  /** Genuine buyers that were dropped because they're off your current niche.
   *  Lets the UI explain an empty/thin feed ("your niche is filtering these
   *  out") instead of looking broken. */
  offNicheCount: number
  /** True when there's no niche to anchor relevance on — the hero shows a
   *  "set your niche" prompt instead of ranking unverified signals (which is
   *  how an off-niche post becomes the #1 "hottest buyer"). */
  needsNiche?: boolean
}

export async function loadHotSignals(
  db: SupabaseClient,
  opts: { windowMs: number; projectId?: string; limit?: number; minScore?: number },
): Promise<HotSignalsResult> {
  const projectId = opts.projectId ?? DEFAULT_PROJECT
  // Trust gate: with no niche to anchor relevance on, the gate can't tell an
  // on-niche buyer from junk (it degrades everything to "relevant"), which is
  // exactly how an off-niche post becomes the #1 "hottest buyer". Show a
  // "set your niche" prompt instead of ranking unverified signals.
  const nicheText = await loadNicheText(db, projectId)
  if (!nicheText.trim()) {
    return { signals: [], offNicheCount: 0, needsNiche: true }
  }
  // Union the legacy `posts` path (interactive browser scans) with the unified
  // `signals` table (cron / external-scheduler ingest). These tables never met
  // before, so cron-ingested demand never surfaced here; reading both — deduped
  // by post id — closes that gap without regressing the interactive-scan feed.
  const [postSignals, ingestedSignals, memFacts] = await Promise.all([
    loadSignals(db, { ageMs: opts.windowMs }),
    loadIngestedSignals(db, { ageMs: opts.windowMs }),
    loadMemoryFacts(db, projectId),
  ])
  const signals = mergeSignalsByPostId(postSignals, ingestedSignals)
  // Combined gate before scoring so Hot-now only ever shows on-niche genuine
  // buyers: (1) buyer-intent (drops makers/discussion), then (2) relevance to
  // the active project (drops off-niche), qualifying only relevance >= τ.
  const buyers = await gateSignals(db, signals, { projectId })
  const relevance = await loadRelevance(db, buyers, projectId)
  const tau = relevanceTau()
  // Fail-closed for the trust-critical hero: a buyer qualifies only if it was
  // ACTUALLY screened on-niche (a real embedding/Haiku verdict) and clears τ.
  // Unscreened signals (the FULLY_RELEVANT score-1 fallback for over-cap /
  // infra failure) must never become the hottest buyer — that's the junk-hero
  // leak. Other surfaces (leads/signals) keep the lenient "never hide a lead".
  const qualified = buyers.filter((s) => {
    const r = relevance.get(keyOf(s))
    return !!r && r.screened === true && r.score >= tau
  })
  // Buyers we dropped for being off-niche or unverifiable — surfaced so the
  // hero can point you at your niche settings instead of looking broken.
  const offNicheCount = buyers.length - qualified.length

  const memText = fitText(memFacts)
  const scored = qualified.map((s) =>
    scoreSignal(
      s,
      computeFitToYou(memText, `${s.topic ?? ''} ${s.text}`),
      relevance.get(keyOf(s))?.score ?? 1,
    ),
  )
  return {
    signals: rankHotSignals(scored, { limit: opts.limit, minScore: opts.minScore }),
    offNicheCount,
    needsNiche: false,
  }
}
