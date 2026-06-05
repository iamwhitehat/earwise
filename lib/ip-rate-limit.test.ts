import { describe, it, expect } from 'vitest'
import { rateDecision, clientIp, type RateRow } from './ip-rate-limit'

const NOW = 1_000_000_000_000
const HOUR = 3_600_000

describe('rateDecision', () => {
  it('starts a fresh 24h window when there is no row', () => {
    const d = rateDecision(null, 5, NOW)
    expect(d.allowed).toBe(true)
    expect(d.count).toBe(1)
    expect(d.resetAt).toBe(NOW + 24 * HOUR)
  })

  it('increments within an active window below the cap', () => {
    const row: RateRow = { count: 2, reset_at: new Date(NOW + 5 * HOUR).toISOString() }
    const d = rateDecision(row, 5, NOW)
    expect(d).toEqual({ allowed: true, count: 3, resetAt: NOW + 5 * HOUR })
  })

  it('blocks at the cap within an active window (counter unchanged)', () => {
    const row: RateRow = { count: 5, reset_at: new Date(NOW + 5 * HOUR).toISOString() }
    const d = rateDecision(row, 5, NOW)
    expect(d.allowed).toBe(false)
    expect(d.count).toBe(5)
  })

  it('resets to a fresh window once the old one has expired', () => {
    const row: RateRow = { count: 5, reset_at: new Date(NOW - HOUR).toISOString() }
    const d = rateDecision(row, 5, NOW)
    expect(d).toEqual({ allowed: true, count: 1, resetAt: NOW + 24 * HOUR })
  })

  it('treats a garbage reset_at as expired (fresh window, allowed)', () => {
    const row: RateRow = { count: 99, reset_at: 'not-a-date' }
    const d = rateDecision(row, 5, NOW)
    expect(d.allowed).toBe(true)
    expect(d.count).toBe(1)
  })
})

describe('clientIp', () => {
  it('prefers the unforgeable x-real-ip over x-forwarded-for', () => {
    const h = new Headers({ 'x-real-ip': '198.51.100.2', 'x-forwarded-for': '1.2.3.4, 10.0.0.1' })
    expect(clientIp(h)).toBe('198.51.100.2')
  })
  it('falls back to the LAST x-forwarded-for hop (not the client-spoofable first)', () => {
    // '1.2.3.4' is client-claimed; '203.0.113.7' is what the trusted edge appended.
    expect(clientIp(new Headers({ 'x-forwarded-for': '1.2.3.4, 203.0.113.7' }))).toBe('203.0.113.7')
  })
  it('defaults to unknown with no headers', () => {
    expect(clientIp(new Headers())).toBe('unknown')
  })
})
