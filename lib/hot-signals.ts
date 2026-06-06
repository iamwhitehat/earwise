// Hot-now feed (Convert #1, speed-to-lead). Pure scoring + ranking of recent
// high-intent signals so the freshest × hottest float to the top. The DB load
// lives in /api/hot-signals; this stays testable (no server-only).
import { scoreLead, type Tier, type ScoreBreakdown } from './lead-score'
import type { SignalRow } from './signals-db'
import type { IntentType } from './intent-patterns'

export type HotSignal = SignalRow & { score: number; tier: Tier; breakdown: ScoreBreakdown }

/** Score one signal. Recency uses the TRUE post time (`postedAt`) when known,
 *  falling back to `analyzedAt` (scan time) only for legacy rows that lack it —
 *  so a stale thread scanned today no longer scores as "fresh". Engagement is
 *  absent for RSS. `relevance` is the signal's 0..1 fit to the active project. */
export function scoreSignal(signal: SignalRow, icpFit: number, relevance = 0.5, now?: number): HotSignal {
  const s = scoreLead({
    intentType: signal.intentType as IntentType,
    relevance,
    postedAt: signal.postedAt ?? signal.analyzedAt,
    icpFit,
    // Within-source normalized engagement (score_norm) — comparable across
    // sources. Absent on legacy/posts rows → 0 (Reddit's prior behavior).
    engagement: signal.engagementNorm ?? 0,
    now,
  })
  return { ...signal, score: s.score, tier: s.tier, breakdown: s.breakdown }
}

/** A reply is only worth sending while the thread is still live. On Reddit that
 *  window is hours-to-a-day, so we treat anything older than ~48h as a dead lead
 *  for ALERTING purposes (the Hot-now lane may still show it, labeled). When the
 *  true post age is unknown we don't gate — better to alert than silently drop. */
export const MAX_REPLY_AGE_MS = 48 * 60 * 60 * 1000

export function isFreshEnoughToReply(
  signal: Pick<SignalRow, 'postedAt'>,
  maxAgeMs: number = MAX_REPLY_AGE_MS,
  now: number = Date.now(),
): boolean {
  if (signal.postedAt == null) return true
  return now - signal.postedAt <= maxAgeMs
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
