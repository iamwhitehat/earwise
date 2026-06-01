// Whitespace v1 — a 0..1 estimate of how open an opportunity is: high when
// there's unmet demand and people are unhappy with incumbents, low when the
// space is already crowded with solutions. Pure + testable; compute-on-read
// (no storage). Inputs are normalized 0..1 signals derived from the topic's
// posts (categories + deep-scan tools/quotes).
//
//   whitespace = sigmoid( wU·unansweredDemand
//                       + wD·incumbentDissatisfaction
//                       − wS·solutionSaturation
//                       − bias )
//
// All three inputs are evidence-gated on deep scans where solution info
// actually exists, so a topic with no deep scans lands near the neutral-low
// middle rather than falsely reading as wide-open.

const W_UNANSWERED = 1.5
const W_DISSATISFACTION = 1.3
const W_SATURATION = 1.8
const BIAS = 0.15
const GAIN = 3

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)
const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x))

export type WhitespaceInputs = {
  /** Share of demand posts with no solution pointed at (0..1). */
  unansweredDemand: number
  /** Strength of dissatisfaction with incumbents (0..1). */
  incumbentDissatisfaction: number
  /** How crowded the space already is (0..1). */
  solutionSaturation: number
}

/** Core scorer. Returns 0..1; inputs are clamped defensively. */
export function computeWhitespace(inputs: WhitespaceInputs): number {
  const u = clamp01(inputs.unansweredDemand)
  const d = clamp01(inputs.incumbentDissatisfaction)
  const s = clamp01(inputs.solutionSaturation)
  const z = W_UNANSWERED * u + W_DISSATISFACTION * d - W_SATURATION * s - BIAS
  return sigmoid(GAIN * z)
}

export type WhitespaceCounts = {
  total: number
  toolComplaintPosts: number
  /** Deep-scanned posts in the topic (tools/quotes known). */
  deepCount: number
  /** Deep-scanned pain/feature posts. */
  deepDemand: number
  /** Of `deepDemand`, how many mention no tool (nobody's solving it). */
  deepDemandNoTool: number
  /** 'hate'-type quotes across the topic's deep scans. */
  hateQuotes: number
  /** Distinct tools mentioned across the topic's deep scans. */
  distinctTools: number
}

// How many distinct tools counts as a "fully saturated" space.
const SATURATION_FULL = 8

/**
 * Normalize raw per-topic counts into the 0..1 whitespace inputs.
 *  - unansweredDemand: fraction of deep demand posts with no tool mentioned
 *    (falls back to 0 when there's no deep demand evidence).
 *  - incumbentDissatisfaction: tool-complaint share + hate-quote density.
 *  - solutionSaturation: distinct tools vs SATURATION_FULL.
 */
export function whitespaceInputsFromCounts(c: WhitespaceCounts): WhitespaceInputs {
  const total = Math.max(1, c.total)
  const unansweredDemand = c.deepDemand > 0 ? c.deepDemandNoTool / c.deepDemand : 0
  const hateDensity = c.deepCount > 0 ? c.hateQuotes / c.deepCount : 0
  const incumbentDissatisfaction = clamp01(c.toolComplaintPosts / total + hateDensity)
  const solutionSaturation = clamp01(c.distinctTools / SATURATION_FULL)
  return { unansweredDemand, incumbentDissatisfaction, solutionSaturation }
}

/** Convenience: counts → 0..1 whitespace score in one call. */
export function whitespaceFromCounts(c: WhitespaceCounts): number {
  return computeWhitespace(whitespaceInputsFromCounts(c))
}
