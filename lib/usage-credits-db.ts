// Durable per-workspace usage-credit metering — the cost guard. Charges credits
// against the `project_usage` table before a route spends Claude tokens. Pure
// decision logic lives in lib/usage-credits.ts.
//
// Fail policy (matches the IP rate limiter): a READ error / missing table fails
// OPEN (pre-migration tolerance), a WRITE error fails CLOSED (don't spend
// uncounted).
//
// Known limitations (acceptable for a solo-founder app; upgrade with the
// auth/multi-tenant build):
//  - Read-then-write is NOT atomic, so a concurrent burst from ONE workspace can
//    overshoot its budget by ~the in-flight HTTP concurrency. (This is NOT bounded
//    by the Claude limiter — that runs AFTER this gate, and is per-instance.)
//    The fix is an atomic Postgres `... on conflict do update set credits_used =
//    credits_used + cost where credits_used + cost <= budget returning ...` RPC.
//  - The meter keys on activeProjectId() (the rr_project cookie), and projects
//    have no owner yet — so it inherits the app's current lack of tenant
//    isolation (see AUTH-ONBOARDING-PLAN.md): a workspace can reset its budget by
//    creating a new one, and once there are multiple real tenants, ownership
//    checks are needed so one tenant can't charge another's budget. Real
//    per-account enforcement requires the auth layer.
//  - Cron (/api/cron/run) is owner-controlled SYSTEM spend and is intentionally
//    NOT metered against the default workspace's budget.
import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { creditDecision, resolveBudget, creditsFor, type CreditOp } from './usage-credits'

export type ChargeOutcome = { allowed: boolean; remaining: number }

export async function chargeCredits(
  db: SupabaseClient,
  projectId: string,
  cost: number,
  opts: { budget?: number; now?: number } = {},
): Promise<ChargeOutcome> {
  const now = opts.now ?? Date.now()
  const budget = opts.budget ?? resolveBudget()

  let row: { credits_used: number; reset_at: string } | null
  try {
    const { data, error } = await db
      .from('project_usage')
      .select('credits_used, reset_at')
      .eq('project_id', projectId)
      .maybeSingle()
    if (error) return { allowed: true, remaining: budget } // fail open (table absent / read error)
    row = data ?? null
  } catch {
    return { allowed: true, remaining: budget }
  }

  const dec = creditDecision(row, budget, cost, now)
  if (!dec.allowed) return { allowed: false, remaining: dec.remaining }

  try {
    const { error } = await db.from('project_usage').upsert(
      { project_id: projectId, credits_used: dec.creditsUsed, reset_at: new Date(dec.resetAt).toISOString() },
      { onConflict: 'project_id' },
    )
    if (error) {
      console.error('[usage-credits] write failed — blocking to avoid uncounted spend:', error.message)
      return { allowed: false, remaining: dec.remaining }
    }
  } catch (err) {
    console.error('[usage-credits] write threw — blocking:', err)
    return { allowed: false, remaining: dec.remaining }
  }
  return { allowed: true, remaining: dec.remaining }
}

export type ChargeOpts = { tier?: unknown; units?: number; budget?: number; now?: number }

/**
 * Charge a named operation, scaled by `units` (e.g. classify-batches, deep-scan
 * posts) and `tier` (synthesis ops cost ~5× on Opus). Haiku-only ops omit tier.
 */
export function chargeOp(
  db: SupabaseClient,
  projectId: string,
  op: CreditOp,
  opts: ChargeOpts = {},
): Promise<ChargeOutcome> {
  return chargeCredits(db, projectId, creditsFor(op, { tier: opts.tier, units: opts.units }), {
    budget: opts.budget,
    now: opts.now,
  })
}

/**
 * Route helper: charge `op` and, if the workspace is over budget, return a ready
 * 402 Response. Returns null when allowed (caller proceeds). One-liner gate:
 *   const over = await gateUsage(db, projectId, 'insights', { tier }); if (over) return over
 */
export async function gateUsage(
  db: SupabaseClient,
  projectId: string,
  op: CreditOp,
  opts: ChargeOpts = {},
): Promise<Response | null> {
  const r = await chargeOp(db, projectId, op, opts)
  if (r.allowed) return null
  return Response.json(
    {
      error: "You've hit this workspace's monthly usage budget. It resets next cycle — or upgrade for more.",
      remaining: r.remaining,
    },
    { status: 402 },
  )
}
