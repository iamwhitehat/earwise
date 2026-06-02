// Lead Score (Convert #2). Pure, unit-tested. Turns a lead's intent strength,
// recency, ICP-fit, and engagement into a 0–100 score + hot/warm/cold tier, with
// a per-factor breakdown for the "why hot?" popover. No Supabase, no server-only.
import type { IntentType } from './intent-patterns'

export type Tier = 'hot' | 'warm' | 'cold'

export type FactorKey = 'intent' | 'recency' | 'icpFit' | 'engagement'

/** Weights sum to 1.0 — see REDESIGN-SPEC › Convert #2. */
export const SCORE_WEIGHTS: Record<FactorKey, number> = {
  intent: 0.45,
  recency: 0.25,
  icpFit: 0.2,
  engagement: 0.1,
}

export const TIER_HOT = 70
export const TIER_WARM = 40

/** Recency time-constant (days): a lead decays to ~37% at 14 days. */
const RECENCY_TAU_DAYS = 14
const DAY_MS = 86_400_000

// Intent strength: willing-to-pay > switching > looking-for. Unknown/absent
// intent gets a low floor so it can't masquerade as a strong buyer.
const INTENT_WEIGHT: Record<IntentType, number> = {
  'willing-to-pay': 1.0,
  switching: 0.7,
  'looking-for': 0.45,
}
const INTENT_UNKNOWN = 0.3

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)

export type ScoreInput = {
  intentType?: IntentType | string | null
  /** Epoch ms the lead was posted/created. Absent → neutral recency. */
  postedAt?: number | null
  /** ICP match 0..1 (default 0.5 when business memory is empty). */
  icpFit?: number | null
  /** Normalized engagement 0..1 (0 when absent, e.g. RSS without upvotes). */
  engagement?: number | null
  /** Override "now" for deterministic tests. */
  now?: number
}

export type ScoreBreakdown = Record<FactorKey, { value: number; points: number }>

export type LeadScore = {
  score: number // 0..100
  tier: Tier
  breakdown: ScoreBreakdown
}

function intentFactor(intentType: ScoreInput['intentType']): number {
  if (intentType && intentType in INTENT_WEIGHT) {
    return INTENT_WEIGHT[intentType as IntentType]
  }
  return INTENT_UNKNOWN
}

function recencyFactor(postedAt: number | null | undefined, now: number): number {
  if (postedAt == null || !Number.isFinite(postedAt)) return 0.5
  const ageDays = Math.max(0, (now - postedAt) / DAY_MS)
  return clamp01(Math.exp(-ageDays / RECENCY_TAU_DAYS))
}

export function tierFor(score: number): Tier {
  return score >= TIER_HOT ? 'hot' : score >= TIER_WARM ? 'warm' : 'cold'
}

/** Score a lead 0..100 with tier + per-factor breakdown. Deterministic. */
export function scoreLead(input: ScoreInput): LeadScore {
  const now = input.now ?? Date.now()
  const factors: Record<FactorKey, number> = {
    intent: intentFactor(input.intentType),
    recency: recencyFactor(input.postedAt, now),
    icpFit: clamp01(input.icpFit ?? 0.5),
    engagement: clamp01(input.engagement ?? 0),
  }

  let weighted = 0
  const breakdown = {} as ScoreBreakdown
  for (const key of Object.keys(SCORE_WEIGHTS) as FactorKey[]) {
    const value = factors[key]
    const w = SCORE_WEIGHTS[key]
    weighted += w * value
    breakdown[key] = { value, points: Math.round(w * value * 100) }
  }

  const score = Math.round(100 * weighted)
  return { score, tier: tierFor(score), breakdown }
}

const FACTOR_LABEL: Record<FactorKey, string> = {
  intent: 'intent',
  recency: 'recency',
  icpFit: 'ICP fit',
  engagement: 'engagement',
}

/** Short plain-English reason for the tier ("willing to pay · fresh · ICP match"),
 *  built from the strongest factors. Used by the "why hot?" popover summary. */
export function scoreReason(s: LeadScore): string {
  const top = (Object.keys(s.breakdown) as FactorKey[])
    .filter((k) => s.breakdown[k].value >= 0.6)
    .sort((a, b) => s.breakdown[b].value - s.breakdown[a].value)
    .map((k) => FACTOR_LABEL[k])
  return top.length > 0 ? top.join(' · ') : 'low signal'
}
