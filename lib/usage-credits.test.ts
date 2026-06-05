import { describe, it, expect } from 'vitest'
import { creditDecision, CREDIT_COST, tierMultiplier, creditsFor, type UsageRow } from './usage-credits'

const NOW = 1_700_000_000_000
const DAY = 86_400_000

describe('creditDecision', () => {
  it('starts a fresh 30-day window with no row', () => {
    const d = creditDecision(null, 1000, 30, NOW)
    expect(d.allowed).toBe(true)
    expect(d.creditsUsed).toBe(30)
    expect(d.remaining).toBe(970)
    expect(d.resetAt).toBe(NOW + 30 * DAY)
  })

  it('charges within budget in an active window', () => {
    const row: UsageRow = { credits_used: 900, reset_at: new Date(NOW + 5 * DAY).toISOString() }
    const d = creditDecision(row, 1000, 50, NOW)
    expect(d).toEqual({ allowed: true, creditsUsed: 950, resetAt: NOW + 5 * DAY, remaining: 50 })
  })

  it('blocks when the charge would exceed the budget (counter unchanged)', () => {
    const row: UsageRow = { credits_used: 980, reset_at: new Date(NOW + 5 * DAY).toISOString() }
    const d = creditDecision(row, 1000, 50, NOW) // 980 + 50 = 1030 > 1000
    expect(d.allowed).toBe(false)
    expect(d.creditsUsed).toBe(980)
    expect(d.remaining).toBe(20)
  })

  it('allows a charge that lands exactly on the budget', () => {
    const row: UsageRow = { credits_used: 970, reset_at: new Date(NOW + 5 * DAY).toISOString() }
    const d = creditDecision(row, 1000, 30, NOW)
    expect(d.allowed).toBe(true)
    expect(d.creditsUsed).toBe(1000)
    expect(d.remaining).toBe(0)
  })

  it('resets to a fresh window when the old one has expired', () => {
    const row: UsageRow = { credits_used: 1000, reset_at: new Date(NOW - DAY).toISOString() }
    const d = creditDecision(row, 1000, 30, NOW)
    expect(d).toEqual({ allowed: true, creditsUsed: 30, resetAt: NOW + 30 * DAY, remaining: 970 })
  })

  it('treats a garbage reset_at as expired (fresh window)', () => {
    const row: UsageRow = { credits_used: 99999, reset_at: 'not-a-date' }
    const d = creditDecision(row, 1000, 30, NOW)
    expect(d.allowed).toBe(true)
    expect(d.creditsUsed).toBe(30)
  })

  it('weights map the cost drivers above the cheap drafts', () => {
    expect(CREDIT_COST.insights).toBeGreaterThan(CREDIT_COST.deepScanPost)
    expect(CREDIT_COST.deepScanPost).toBeGreaterThan(CREDIT_COST.draft)
    expect(CREDIT_COST.draft).toBe(2)
  })
})

describe('tierMultiplier + creditsFor', () => {
  it('charges ~5x on Max (Opus) and ~0.3x on Fast (Haiku) vs balanced default', () => {
    expect(tierMultiplier('balanced')).toBe(1)
    expect(tierMultiplier('max')).toBe(5)
    expect(tierMultiplier('fast')).toBe(0.3)
    expect(tierMultiplier(undefined)).toBe(1) // default = Sonnet
    expect(tierMultiplier('garbage')).toBe(1)
  })

  it('scales a synthesis op by tier so Opus cannot under-charge', () => {
    expect(creditsFor('insights')).toBe(CREDIT_COST.insights) // 180, default Sonnet
    expect(creditsFor('insights', { tier: 'max' })).toBe(CREDIT_COST.insights * 5) // 900, Opus
  })

  it('scales a per-unit Haiku op (scan) by batch count, no tier', () => {
    expect(creditsFor('scan', { units: 1 })).toBe(CREDIT_COST.scan)
    expect(creditsFor('scan', { units: 50 })).toBe(CREDIT_COST.scan * 50)
    // a Haiku op ignores tier in practice (callers pass none) → multiplier 1
    expect(creditsFor('deepScanPost', { units: 3 })).toBe(CREDIT_COST.deepScanPost * 3)
  })

  it('floors units at 1 and rounds up fractional charges', () => {
    expect(creditsFor('draft', { units: 0 })).toBe(CREDIT_COST.draft)
    expect(creditsFor('voice', { tier: 'fast' })).toBe(Math.ceil(CREDIT_COST.voice * 0.3))
  })
})
