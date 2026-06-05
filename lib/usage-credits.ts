// Per-workspace usage credits — the margin guarantee. 1 credit ≈ $0.001 of
// Claude spend. Each cost-bearing op deducts its weight; when the monthly budget
// is spent, cost-bearing routes return 402. So gross margin holds by construction
// (budget = price × (1 − target margin)). Pure (no server-only) so it's testable;
// the DB read/write wrapper lives in lib/usage-credits-db.ts.

export const WINDOW_MS = 30 * 24 * 60 * 60 * 1000 // rolling 30-day budget window
export const DEFAULT_BUDGET = 14_500 // ≈ $14.50 of Claude spend / workspace / month

/** Credit weight ≈ Claude COGS per op (1 credit ≈ $0.001). Haiku ops carry their
 *  Haiku cost; the synthesis ops are calibrated to the DEFAULT (Sonnet) tier and
 *  scaled up by tierMultiplier when the caller selects Max/Opus (≈ 5× Sonnet) —
 *  otherwise a Max run would under-charge ~5× and blow the margin. `scan` and
 *  `deepScanPost` are charged per UNIT (per classify-batch / per post). */
export const CREDIT_COST = {
  scan: 4, // per Haiku classify/backfill batch (~8 posts)
  deepScanPost: 5, // per post deep-scanned (1 Haiku call each)
  insights: 180, // insights refresh (2 Sonnet calls @ default; ×5 on Opus)
  voice: 70, // voice-brief refresh (1 Sonnet call)
  buyerLanguage: 160, // buyer-language + messaging (2 Sonnet calls)
  strategy: 140, // strategy run (1 Sonnet call @ default)
  draft: 2, // opener / reply / follow-up / objection (1 Haiku call)
} as const
export type CreditOp = keyof typeof CREDIT_COST

/** Scale a synthesis weight for the model the caller actually selected. Base
 *  weights assume Sonnet (balanced, the default); Opus is ~5× Sonnet, Haiku ~0.3×.
 *  Haiku-only ops (scan/deepScanPost/draft) pass no tier → multiplier 1. */
export function tierMultiplier(tier: unknown): number {
  const t = typeof tier === 'string' ? tier.trim().toLowerCase() : ''
  if (t === 'max') return 5 // Opus ≈ 5× Sonnet (cover the worst case)
  if (t === 'fast') return 0.3 // Haiku ≈ 0.27× Sonnet (slight over-charge for safety)
  return 1 // balanced / Sonnet (default)
}

/** Credits to charge for an op, scaled by units (count) and the selected tier. */
export function creditsFor(op: CreditOp, opts: { tier?: unknown; units?: number } = {}): number {
  return Math.ceil(CREDIT_COST[op] * Math.max(1, opts.units ?? 1) * tierMultiplier(opts.tier))
}

export type UsageRow = { credits_used: number; reset_at: string } | null

export type CreditDecision = {
  allowed: boolean
  /** credits_used value to persist (incremented when allowed). */
  creditsUsed: number
  /** epoch ms of the window reset to persist. */
  resetAt: number
  /** credits left in the window after this decision. */
  remaining: number
}

/** Monthly credit budget per workspace (env USAGE_CREDITS_BUDGET, else default). */
export function resolveBudget(): number {
  const raw = process.env.USAGE_CREDITS_BUDGET
  if (raw === undefined || raw.trim() === '') return DEFAULT_BUDGET
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return DEFAULT_BUDGET
  return Math.floor(n)
}

/**
 * Decide whether to allow charging `cost` credits given the current row + budget.
 * Starts a fresh window when there's no row or the window has expired. Pure.
 */
export function creditDecision(
  row: UsageRow,
  budget: number,
  cost: number,
  now: number,
  windowMs = WINDOW_MS,
): CreditDecision {
  const resetAtMs = row ? new Date(row.reset_at).getTime() : 0
  const active = row != null && Number.isFinite(resetAtMs) && resetAtMs > now
  const used = active ? row.credits_used : 0
  const resetAt = active ? resetAtMs : now + windowMs
  const after = used + Math.max(0, cost)
  if (after > budget) {
    return { allowed: false, creditsUsed: used, resetAt, remaining: Math.max(0, budget - used) }
  }
  return { allowed: true, creditsUsed: after, resetAt, remaining: Math.max(0, budget - after) }
}
