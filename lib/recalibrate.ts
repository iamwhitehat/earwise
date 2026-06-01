// Recalibration (Phase 7 / LEARN). Turns realized outcomes (the `events`
// table) into two feedback signals — all pure + unit-tested:
//
//  1. Advantage-weight recalibration. Each opportunity the founder *pursues*
//     vs *parks* is a revealed preference carrying a component snapshot. We
//     nudge the Advantage weights toward the component profile of pursued
//     opportunities, so ranking learns what this founder actually chases.
//
//  2. "What's working" conversion analysis over the lead funnel
//     (draft_sent → reply → call_booked → conversion, lead_passed = lost),
//     grouped by angle (intent / topic / subreddit). Feeds the opener
//     guidance, the accrued business_memory, and the dashboard panel.
import {
  DEFAULT_ADVANTAGE_WEIGHTS,
  type AdvantageWeights,
  type AdvantageComponents,
} from './advantage'
import type { AppEvent, EventKind } from './events'

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)

const COMPONENT_KEYS: (keyof AdvantageComponents)[] = [
  'demand',
  'monetization',
  'momentum',
  'whitespace',
  'fitToYou',
]

// ─── Advantage-weight recalibration ──────────────────────────────────────────

export type OutcomeSample = { components: AdvantageComponents; won: boolean }

export type RecalibrationResult = {
  weights: AdvantageWeights
  sampleCount: number
  wins: number
  losses: number
  /** true when enough discriminating data existed to move off `base`. */
  adjusted: boolean
}

/** Need at least this many pursued/parked decisions before trusting the data. */
export const MIN_RECAL_SAMPLES = 5
const LEARNING_RATE = 0.5
const WEIGHT_FLOOR = 0.02

/** Coerce an arbitrary payload into a full AdvantageComponents, or null when
 *  any of the five fields is missing / non-finite. Accepts either a nested
 *  `components` object or the five fields flat on the payload. */
export function coerceComponents(raw: unknown): AdvantageComponents | null {
  const o = (raw ?? {}) as Record<string, unknown>
  const src = (o.components && typeof o.components === 'object' ? o.components : o) as Record<
    string,
    unknown
  >
  const out = {} as AdvantageComponents
  for (const k of COMPONENT_KEYS) {
    const v = src[k]
    if (typeof v !== 'number' || !Number.isFinite(v)) return null
    out[k] = clamp01(v)
  }
  return out
}

/** Build pursue=win / park=loss samples (with component snapshots) from events. */
export function buildOutcomeSamples(events: AppEvent[]): OutcomeSample[] {
  const out: OutcomeSample[] = []
  for (const e of events) {
    if (e.kind !== 'opportunity_pursued' && e.kind !== 'opportunity_parked') continue
    const components = coerceComponents(e.payload)
    if (!components) continue
    out.push({ components, won: e.kind === 'opportunity_pursued' })
  }
  return out
}

/**
 * Nudge Advantage weights toward the component profile that distinguishes
 * winners from losers. For each component the signal is (mean among winners −
 * mean among losers) ∈ [−1, 1]; the weight is scaled by (1 + rate·signal),
 * floored, then renormalized to the base's total. Returns `base` unchanged
 * when the sample is too small or one-sided (no wins or no losses).
 */
export function recalibrateWeights(
  samples: OutcomeSample[],
  base: AdvantageWeights = DEFAULT_ADVANTAGE_WEIGHTS,
): RecalibrationResult {
  const wins = samples.filter((s) => s.won)
  const losses = samples.filter((s) => !s.won)
  if (samples.length < MIN_RECAL_SAMPLES || wins.length === 0 || losses.length === 0) {
    return {
      weights: base,
      sampleCount: samples.length,
      wins: wins.length,
      losses: losses.length,
      adjusted: false,
    }
  }

  const mean = (arr: OutcomeSample[], k: keyof AdvantageComponents): number =>
    arr.reduce((s, x) => s + clamp01(x.components[k]), 0) / arr.length

  const raw: Record<keyof AdvantageComponents, number> = { ...base }
  for (const k of COMPONENT_KEYS) {
    const signal = mean(wins, k) - mean(losses, k) // [-1, 1]
    raw[k] = Math.max(WEIGHT_FLOOR, base[k] * (1 + LEARNING_RATE * signal))
  }

  // Renormalize so the recalibrated weights sum to the same total as `base`
  // (defaults sum to 1) — keeps them comparable across runs.
  const total = COMPONENT_KEYS.reduce((s, k) => s + raw[k], 0)
  const baseTotal = COMPONENT_KEYS.reduce((s, k) => s + base[k], 0)
  const scale = total > 0 ? baseTotal / total : 1
  const weights = {
    demand: raw.demand * scale,
    monetization: raw.monetization * scale,
    momentum: raw.momentum * scale,
    whitespace: raw.whitespace * scale,
    fitToYou: raw.fitToYou * scale,
  }

  return { weights, sampleCount: samples.length, wins: wins.length, losses: losses.length, adjusted: true }
}

// ─── "What's working" conversion analysis ────────────────────────────────────

export type FunnelTotals = {
  draftsSent: number
  replies: number
  callsBooked: number
  conversions: number
  passed: number
}

export type ConversionDimension = 'intentType' | 'topic' | 'subreddit'

export type ConversionRate = {
  key: string
  draftsSent: number
  replies: number
  callsBooked: number
  conversions: number
  passed: number
  /** conversions / draftsSent, 0..1 (0 when nothing was sent). */
  rate: number
  /** replies / draftsSent, 0..1. */
  replyRate: number
}

function bump(t: FunnelTotals, kind: EventKind): void {
  if (kind === 'draft_sent') t.draftsSent++
  else if (kind === 'reply') t.replies++
  else if (kind === 'call_booked') t.callsBooked++
  else if (kind === 'conversion') t.conversions++
  else if (kind === 'lead_passed') t.passed++
}

const emptyTotals = (): FunnelTotals => ({
  draftsSent: 0,
  replies: 0,
  callsBooked: 0,
  conversions: 0,
  passed: 0,
})

/** Overall lead-funnel counts across all events. */
export function funnelTotals(events: AppEvent[]): FunnelTotals {
  const t = emptyTotals()
  for (const e of events) if (e.entity === 'lead') bump(t, e.kind)
  return t
}

/**
 * Conversion rates grouped by an angle dimension (intent / topic / subreddit),
 * read from each event's payload. Groups with no drafts sent are dropped;
 * sorted by conversions, then rate, then volume — best-converting angle first.
 */
export function conversionRates(
  events: AppEvent[],
  dimension: ConversionDimension = 'intentType',
): ConversionRate[] {
  const groups = new Map<string, FunnelTotals>()
  for (const e of events) {
    if (e.entity !== 'lead') continue
    const raw = e.payload[dimension]
    const key = typeof raw === 'string' ? raw.trim() : ''
    if (!key) continue
    let g = groups.get(key)
    if (!g) {
      g = emptyTotals()
      groups.set(key, g)
    }
    bump(g, e.kind)
  }
  return [...groups.entries()]
    .map(([key, t]) => ({
      key,
      ...t,
      rate: t.draftsSent > 0 ? t.conversions / t.draftsSent : 0,
      replyRate: t.draftsSent > 0 ? t.replies / t.draftsSent : 0,
    }))
    .filter((r) => r.draftsSent > 0)
    .sort((a, b) => b.conversions - a.conversions || b.rate - a.rate || b.draftsSent - a.draftsSent)
}

/** Stable prefix for the accrued "what's working" guidance — lets a scheduled
 *  job replace the single learned fact in place instead of accumulating it. */
export const WHATS_WORKING_PREFIX = 'Angles that have converted best so far:'

/**
 * One-line, prompt-injectable summary of which angles convert — used both as
 * opener guidance and as the accrued "what's working" business_memory fact.
 * Returns null when there isn't a single conversion yet (nothing to learn).
 */
export function whatWorkedGuidance(
  events: AppEvent[],
  opts: { dimension?: ConversionDimension; limit?: number } = {},
): string | null {
  const rates = conversionRates(events, opts.dimension ?? 'intentType')
  const winners = rates.filter((r) => r.conversions > 0).slice(0, opts.limit ?? 3)
  if (winners.length === 0) return null
  const parts = winners.map(
    (r) => `${r.key} (${r.conversions}/${r.draftsSent} sent → ${Math.round(r.rate * 100)}%)`,
  )
  return `${WHATS_WORKING_PREFIX} ${parts.join(', ')}. Favor this framing.`
}
