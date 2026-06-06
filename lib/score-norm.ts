// Within-source engagement normalization (the cross-source-comparability fix).
//
// A Reddit upvote, an HN point, and a Stack Overflow score live on different
// scales, so feeding raw counts into the scorer would systematically over-rank
// high-volume sources. Instead we rank each signal's engagement *within its own
// source's recent distribution* and emit a 0..1 percentile (`score_norm`). The
// engine then consumes only this normalized value, never the raw count.
//
// Pure — no network, no DB, no server-only — so it unit-tests in isolation
// (mirrors the lib/signals-util.ts ↔ lib/signals-db.ts split). The DB read of
// the trailing window lives in lib/sources/ingest.ts.
import type { SignalEngagement } from './sources/types'

/** Default trailing window for the within-source distribution (env-tunable in ingest). */
export const DEFAULT_SCORE_NORM_WINDOW_DAYS = 30

/**
 * Combined raw engagement magnitude in a source's native units. Comments are
 * weighted half of score/upvotes — a reply is a weaker buy-signal than an
 * upvote, but still real. Negatives/NaN floor to 0.
 */
export function rawEngagement(e: SignalEngagement | null | undefined): number {
  if (!e) return 0
  const score = typeof e.score === 'number' && e.score > 0 ? e.score : 0
  const comments = typeof e.comments === 'number' && e.comments > 0 ? e.comments : 0
  return score + 0.5 * comments
}

/**
 * Percentile rank of `value` within its group `population`: the fraction of the
 * group strictly below it. Top element → 1; the bottom and ties at the bottom
 * (e.g. Reddit's zero-engagement RSS rows) → 0. Always 0..1. A group of 0 or 1
 * yields 0 — not enough spread to rank, so engagement stays neutral.
 */
export function percentileRank(value: number, population: number[]): number {
  const n = population.length
  if (n <= 1) return 0
  let below = 0
  for (const v of population) if (v < value) below++
  return clamp01(below / (n - 1))
}

/**
 * Batch form: percentile rank of every value against the same population (the
 * array itself). O(n log n). Used at ingest to normalize a source's batch in
 * one pass. Two sources with wildly different raw scales but the same shape
 * produce the same normalized distribution — that is the whole point.
 */
export function percentilesOf(values: number[]): number[] {
  const n = values.length
  if (n <= 1) return values.map(() => 0)
  const sorted = [...values].sort((a, b) => a - b)
  return values.map((v) => {
    // count strictly less than v = first index where sorted[i] === v (binary search)
    let lo = 0, hi = n
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (sorted[mid] < v) lo = mid + 1
      else hi = mid
    }
    return clamp01(lo / (n - 1))
  })
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0
  return x < 0 ? 0 : x > 1 ? 1 : x
}
