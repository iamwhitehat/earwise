// Pure decision logic + IP extraction for the public-scan daily rate limit.
// Kept free of `server-only` / Supabase so it's unit-testable; the DB read/write
// wrapper lives in lib/ip-rate-limit-db.ts.

export const WINDOW_MS = 24 * 60 * 60 * 1000
export const GLOBAL_KEY = '__global__'
export const DEFAULT_PER_IP_CAP = 5
export const DEFAULT_GLOBAL_CAP = 300

export type RateRow = { count: number; reset_at: string } | null

export type RateDecision = {
  allowed: boolean
  /** Counter value to persist (incremented when allowed; unchanged when blocked). */
  count: number
  /** Epoch ms of the window reset to persist. */
  resetAt: number
}

/**
 * Given the current row (or null) for a key, decide whether to allow the request
 * and what the next counter state should be. Starts a fresh window when there's
 * no row or the window has expired. Pure.
 */
export function rateDecision(row: RateRow, cap: number, now: number, windowMs = WINDOW_MS): RateDecision {
  const resetAtMs = row ? new Date(row.reset_at).getTime() : 0
  const windowActive = row != null && Number.isFinite(resetAtMs) && resetAtMs > now
  if (windowActive) {
    if (row.count >= cap) return { allowed: false, count: row.count, resetAt: resetAtMs }
    return { allowed: true, count: row.count + 1, resetAt: resetAtMs }
  }
  return { allowed: true, count: 1, resetAt: now + windowMs }
}

export type RateLimitOutcome = { allowed: boolean; reason?: 'ip' | 'global' }

/**
 * Extract the client IP for rate-limiting. Prefer `x-real-ip` — Vercel sets it to
 * the real connecting IP and the client cannot forge it. NEVER trust the leftmost
 * `x-forwarded-for` hop (a client can prepend arbitrary values there); fall back
 * to the LAST hop, which the trusted edge appended. Defaults to 'unknown' (all
 * unknown-IP requests then share one bucket — still capped).
 */
export function clientIp(headers: Headers): string {
  const real = headers.get('x-real-ip')?.trim()
  if (real) return real
  const fwd = headers.get('x-forwarded-for')
  if (fwd) {
    const parts = fwd.split(',').map((s) => s.trim()).filter(Boolean)
    if (parts.length > 0) return parts[parts.length - 1]!
  }
  return 'unknown'
}
