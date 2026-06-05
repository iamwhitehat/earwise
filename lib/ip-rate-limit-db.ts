// Durable per-IP (+ global) daily rate limit for the public, ungated
// /api/public/scan endpoint. Backed by the `ip_rate_limits` Supabase table so it
// survives Vercel cold-starts (an in-memory Map would reset per instance). Pure
// decision logic + IP extraction live in lib/ip-rate-limit.ts.
import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  rateDecision,
  GLOBAL_KEY,
  DEFAULT_PER_IP_CAP,
  DEFAULT_GLOBAL_CAP,
  type RateLimitOutcome,
} from './ip-rate-limit'

/**
 * Check the per-IP and global daily caps and, when allowed, increment both
 * counters.
 *
 * Fail policy: a READ error / missing table fails OPEN (pre-migration tolerance —
 * the global Claude limiter still bounds total spend). A WRITE error fails CLOSED
 * (this is a cost guard on an ungated endpoint; better to 429 a request we
 * couldn't count than to spend uncounted Claude tokens).
 *
 * Known limitation: read-then-write is NOT atomic, so a concurrent burst can
 * overshoot a cap by ~the in-flight concurrency (notably on the shared
 * `__global__` row). Bounded and acceptable here — the per-IP cap holds (the IP
 * comes from the unforgeable x-real-ip), so reaching the global cap needs many
 * real IPs, and the process-wide Claude limiter caps the burst rate regardless.
 * Upgrade to an atomic Postgres `... on conflict do update set count = count + 1
 * returning` RPC if public volume ever makes the overshoot matter.
 */
export async function checkAndIncrement(
  db: SupabaseClient,
  ip: string,
  opts: { perIpCap?: number; globalCap?: number; now?: number } = {},
): Promise<RateLimitOutcome> {
  const now = opts.now ?? Date.now()
  const perIpCap = opts.perIpCap ?? DEFAULT_PER_IP_CAP
  const globalCap = opts.globalCap ?? DEFAULT_GLOBAL_CAP

  let rows: Array<{ ip: string; count: number; reset_at: string }>
  try {
    const { data, error } = await db
      .from('ip_rate_limits')
      .select('ip, count, reset_at')
      .in('ip', [ip, GLOBAL_KEY])
    if (error) return { allowed: true } // fail open (table absent / read error)
    rows = (data ?? []) as typeof rows
  } catch {
    return { allowed: true }
  }

  const ipRow = rows.find((r) => r.ip === ip) ?? null
  const globalRow = rows.find((r) => r.ip === GLOBAL_KEY) ?? null

  const ipDec = rateDecision(ipRow, perIpCap, now)
  if (!ipDec.allowed) return { allowed: false, reason: 'ip' }
  const globalDec = rateDecision(globalRow, globalCap, now)
  if (!globalDec.allowed) return { allowed: false, reason: 'global' }

  // The Supabase client RETURNS db errors (doesn't throw), so check `error`.
  // A failed counter write means we'd spend uncounted — fail closed.
  try {
    const { error } = await db.from('ip_rate_limits').upsert(
      [
        { ip, count: ipDec.count, reset_at: new Date(ipDec.resetAt).toISOString() },
        { ip: GLOBAL_KEY, count: globalDec.count, reset_at: new Date(globalDec.resetAt).toISOString() },
      ],
      { onConflict: 'ip' },
    )
    if (error) {
      console.error('[ip-rate-limit] counter write failed — blocking to avoid uncounted spend:', error.message)
      return { allowed: false, reason: 'global' }
    }
  } catch (err) {
    console.error('[ip-rate-limit] counter write threw — blocking:', err)
    return { allowed: false, reason: 'global' }
  }
  return { allowed: true }
}
