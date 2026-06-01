// Advantage Score (Phase 4 / DECIDE). Ranks opportunities by expected value
// FOR THIS founder, not raw signal:
//
//   Advantage = wD·Demand + wM·Monetization + wMo·Momentum + wW·Whitespace + wF·FitToYou
//
// All five components are 0..1; the weighted sum is normalized to 0..1 so the
// weights are tunable without rescaling. Demand / Momentum / FitToYou are
// computed here; Monetization + Whitespace arrive precomputed (0..1) from the
// aggregator. Pure + unit-tested.
import { computeDirection } from './snapshots'

export type AdvantageWeights = {
  demand: number
  monetization: number
  momentum: number
  whitespace: number
  fitToYou: number
}

export const DEFAULT_ADVANTAGE_WEIGHTS: AdvantageWeights = {
  demand: 0.3,
  monetization: 0.2,
  momentum: 0.15,
  whitespace: 0.15,
  fitToYou: 0.2,
}

export type AdvantageComponents = {
  demand: number
  monetization: number
  momentum: number
  whitespace: number
  fitToYou: number
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)
const sat = (x: number, max: number): number => clamp01(x / max)

export type DemandInputs = {
  posts: number
  uniqueAuthors: number
  engagement: number
  sourceBreadth: number // distinct confirming sources (≥1)
}

/** Demand as a saturating blend of volume, author breadth, engagement, and
 *  cross-source breadth. 0..1, monotonic non-decreasing in every input. */
export function computeDemand(d: DemandInputs): number {
  return clamp01(
    0.45 * sat(Math.log10(1 + Math.max(0, d.posts)), Math.log10(101)) +
      0.25 * sat(Math.log2(1 + Math.max(0, d.uniqueAuthors)), Math.log2(51)) +
      0.2 * sat(Math.log10(1 + Math.max(0, d.engagement)), Math.log10(501)) +
      0.1 * clamp01((Math.max(1, d.sourceBreadth) - 1) / 2),
  )
}

const MOMENTUM_BY_DIRECTION: Record<string, number> = {
  accelerating: 1,
  rising: 0.8,
  stable: 0.5,
  new: 0.45,
  declining: 0.2,
}

/** Momentum from a weekly post-count series, via the shared direction model. */
export function computeMomentum(weeklyCounts: number[]): number {
  return MOMENTUM_BY_DIRECTION[computeDirection(weeklyCounts)] ?? 0.45
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'your', 'you', 'are',
  'how', 'why', 'what', 'who', 'into', 'our', 'their', 'them', 'has', 'have',
])

function tokenize(text: string): Set<string> {
  const out = new Set<string>()
  for (const t of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (t.length >= 3 && !STOPWORDS.has(t)) out.add(t)
  }
  return out
}

/**
 * FitToYou: how well the founder's memory (skills / ICP / channels) matches an
 * opportunity (its topic + example text). Returns 0.5 (neutral) when there's
 * no memory yet — so an empty profile doesn't penalize every opportunity.
 */
export function computeFitToYou(memoryFitText: string, opportunityText: string): number {
  const mem = tokenize(memoryFitText)
  if (mem.size === 0) return 0.5
  const opp = tokenize(opportunityText)
  let matched = 0
  for (const t of mem) if (opp.has(t)) matched++
  // Matching ~5 distinct memory terms saturates to 1.0.
  return clamp01(matched / Math.min(mem.size, 5))
}

export type AdvantageResult = {
  score: number // 0..1
  components: AdvantageComponents
  /** Per-component weighted contribution to the final score (sums to score). */
  contributions: AdvantageComponents
}

/** Weighted, weight-normalized advantage from the five 0..1 components. */
export function computeAdvantage(
  components: AdvantageComponents,
  weights: AdvantageWeights = DEFAULT_ADVANTAGE_WEIGHTS,
): AdvantageResult {
  const c = {
    demand: clamp01(components.demand),
    monetization: clamp01(components.monetization),
    momentum: clamp01(components.momentum),
    whitespace: clamp01(components.whitespace),
    fitToYou: clamp01(components.fitToYou),
  }
  const wSum =
    weights.demand + weights.monetization + weights.momentum + weights.whitespace + weights.fitToYou
  const denom = wSum > 0 ? wSum : 1
  const contributions: AdvantageComponents = {
    demand: (weights.demand * c.demand) / denom,
    monetization: (weights.monetization * c.monetization) / denom,
    momentum: (weights.momentum * c.momentum) / denom,
    whitespace: (weights.whitespace * c.whitespace) / denom,
    fitToYou: (weights.fitToYou * c.fitToYou) / denom,
  }
  const score =
    contributions.demand +
    contributions.monetization +
    contributions.momentum +
    contributions.whitespace +
    contributions.fitToYou
  return { score: clamp01(score), components: c, contributions }
}

/** Coerce an arbitrary object into valid weights (positive numbers), falling
 *  back to defaults per-field. Used when accepting tunable weights from an API. */
export function normalizeWeights(raw: unknown): AdvantageWeights {
  const o = (raw ?? {}) as Record<string, unknown>
  const n = (k: keyof AdvantageWeights): number => {
    const v = o[k]
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : DEFAULT_ADVANTAGE_WEIGHTS[k]
  }
  return {
    demand: n('demand'),
    monetization: n('monetization'),
    momentum: n('momentum'),
    whitespace: n('whitespace'),
    fitToYou: n('fitToYou'),
  }
}
