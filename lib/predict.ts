// Predictive momentum — model a topic's week-over-week trajectory from its
// snapshot counts to flag problems about to spike. Pure + unit-tested.

export type Trend = 'spiking' | 'rising' | 'flat' | 'declining'

export type Momentum = {
  /** Average week-over-week change across the recent window. */
  slope: number
  /** Projected count for next week (≥ 0). */
  projectedNext: number
  /** % change last vs prior week (1 = +100%). */
  pctChange: number
  /** Deltas are increasing and the next week projects a meaningful jump. */
  spikeLikely: boolean
  trend: Trend
}

const WINDOW = 4 // weeks of history to model
const SPIKE_MULTIPLE = 1.4 // projectedNext ≥ last × this → spike
const SPIKE_MIN_BASE = 3 // ignore tiny-number noise

/**
 * Trajectory from a chronological weekly post-count series.
 *  - slope: mean of the recent week-over-week deltas
 *  - projectedNext: last + slope, floored at 0
 *  - spikeLikely: deltas accelerating AND projected jump ≥ SPIKE_MULTIPLE
 */
export function predictMomentum(weeklyCounts: number[]): Momentum {
  const counts = weeklyCounts.filter((n) => typeof n === 'number' && Number.isFinite(n))
  const n = counts.length
  if (n === 0) return { slope: 0, projectedNext: 0, pctChange: 0, spikeLikely: false, trend: 'flat' }
  const last = counts[n - 1]
  if (n === 1) return { slope: 0, projectedNext: last, pctChange: 0, spikeLikely: false, trend: 'flat' }

  const window = counts.slice(Math.max(0, n - WINDOW))
  const deltas: number[] = []
  for (let i = 1; i < window.length; i++) deltas.push(window[i] - window[i - 1])
  const slope = deltas.reduce((a, b) => a + b, 0) / deltas.length

  const prev = counts[n - 2]
  const pctChange = prev > 0 ? (last - prev) / prev : last > 0 ? 1 : 0
  // Project off the most recent delta (carries acceleration forward), not the
  // mean — a 2→4→8→16 series should project ~24, not ~21.
  const lastDelta = deltas[deltas.length - 1]
  const projectedNext = Math.max(0, Math.round(last + lastDelta))

  // Accelerating: each recent delta larger than the one before, and positive.
  let accelerating = deltas.length >= 2 && deltas[deltas.length - 1] > 0
  for (let i = 1; accelerating && i < deltas.length; i++) {
    if (deltas[i] <= deltas[i - 1]) accelerating = false
  }
  const spikeLikely =
    accelerating && last >= SPIKE_MIN_BASE && projectedNext >= last * SPIKE_MULTIPLE

  let trend: Trend
  if (spikeLikely) trend = 'spiking'
  else if (pctChange > 0.2) trend = 'rising'
  else if (pctChange < -0.2) trend = 'declining'
  else trend = 'flat'

  return { slope, projectedNext, pctChange, spikeLikely, trend }
}
