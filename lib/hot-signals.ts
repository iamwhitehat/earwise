// Hot-now feed (Convert #1, speed-to-lead). Pure scoring + ranking of recent
// high-intent signals so the freshest × hottest float to the top. The DB load
// lives in /api/hot-signals; this stays testable (no server-only).
import { scoreLead, type Tier, type ScoreBreakdown } from './lead-score'
import type { SignalRow } from './signals-db'
import type { IntentType } from './intent-patterns'

export type HotSignal = SignalRow & { score: number; tier: Tier; breakdown: ScoreBreakdown }

/** Score one signal (recency from analyzedAt; engagement absent for RSS).
 *  `relevance` is the signal's 0..1 fit to the active project (default 0.5). */
export function scoreSignal(signal: SignalRow, icpFit: number, relevance = 0.5, now?: number): HotSignal {
  const s = scoreLead({
    intentType: signal.intentType as IntentType,
    relevance,
    postedAt: signal.analyzedAt,
    icpFit,
    engagement: 0,
    now,
  })
  return { ...signal, score: s.score, tier: s.tier, breakdown: s.breakdown }
}

/**
 * Rank scored signals freshest × hottest: the Lead Score already blends intent
 * and recency, so sort by score desc, then by recency for ties. Optional
 * minScore threshold and limit.
 */
export function rankHotSignals(
  signals: HotSignal[],
  opts: { minScore?: number; limit?: number } = {},
): HotSignal[] {
  const min = opts.minScore ?? 0
  const ranked = signals
    .filter((s) => s.score >= min)
    .sort((a, b) => b.score - a.score || b.analyzedAt - a.analyzedAt)
  return opts.limit != null ? ranked.slice(0, opts.limit) : ranked
}
