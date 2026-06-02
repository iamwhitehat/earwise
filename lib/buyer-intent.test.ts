import { describe, it, expect } from 'vitest'
import {
  isGenuineBuyer,
  isBuyerRole,
  verdictForRole,
  makerPreflag,
  buildBuyerIntentInput,
  normalizeBuyerVerdicts,
} from './buyer-intent'

describe('isGenuineBuyer / verdictForRole / isBuyerRole', () => {
  it('only the buyer role/verdict is a genuine buyer', () => {
    expect(isGenuineBuyer('buyer')).toBe(true)
    expect(isGenuineBuyer('not_buyer')).toBe(false)
    expect(isGenuineBuyer(null)).toBe(false)
    expect(verdictForRole('buyer')).toBe('buyer')
    expect(verdictForRole('maker')).toBe('not_buyer')
    expect(verdictForRole('discussion')).toBe('not_buyer')
    expect(isBuyerRole('buyer')).toBe(true)
    expect(isBuyerRole('maker')).toBe(false)
  })
})

describe('makerPreflag', () => {
  it('flags self-promo / maker tells (the RHYMEBOOK case)', () => {
    expect(makerPreflag('I will not promote, but I built RHYMEBOOK, a rhyming app — feedback?')).toBe(true)
    expect(makerPreflag("I made a little SaaS for X")).toBe(true)
    expect(makerPreflag("I'm launching my tool next week")).toBe(true)
    expect(makerPreflag('check out my app')).toBe(true)
    expect(makerPreflag('we are looking for beta testers')).toBe(true)
    expect(makerPreflag('my startup helps with onboarding')).toBe(true)
  })
  it('does NOT flag a genuine buyer asking for a tool', () => {
    expect(makerPreflag('Looking for an AI tool to auto-triage our support tickets — any recs?')).toBe(false)
    expect(makerPreflag("We're drowning in Zendesk tickets, what do you use?")).toBe(false)
  })
})

describe('buildBuyerIntentInput', () => {
  it('numbers items 1-based and collapses whitespace', () => {
    const out = buildBuyerIntentInput([{ text: 'looking   for\n a tool' }, { text: 'would pay' }])
    expect(out).toContain('1. looking for a tool')
    expect(out).toContain('2. would pay')
  })
  it('caps long text', () => {
    expect(buildBuyerIntentInput([{ text: 'x'.repeat(2000) }]).length).toBeLessThan(700)
  })
})

describe('normalizeBuyerVerdicts (role-based)', () => {
  it('maps role per index; maker + discussion are not buyers, buyer is', () => {
    const out = normalizeBuyerVerdicts(
      { verdicts: [
        { index: 1, role: 'buyer', intent: 'willing-to-pay', confidence: 'high' },
        { index: 2, role: 'maker' },
        { index: 3, role: 'discussion' }, // the mindset-ramble case
      ] },
      3,
    )
    expect(out[0]).toEqual({ role: 'buyer', isBuyer: true, confidence: 'high', intent: 'willing-to-pay' })
    expect(out[1]).toEqual({ role: 'maker', isBuyer: false, confidence: 'medium', intent: null })
    expect(out[2]).toEqual({ role: 'discussion', isBuyer: false, confidence: 'medium', intent: null })
  })
  it('defaults unknown/junk role to discussion (not a buyer)', () => {
    const out = normalizeBuyerVerdicts({ verdicts: [{ index: 1, role: 'whatever' }] }, 1)
    expect(out[0]?.isBuyer).toBe(false)
    expect(out[0]?.role).toBe('discussion')
  })
  it('ignores out-of-range / duplicate indexes and tolerates junk', () => {
    const out = normalizeBuyerVerdicts({ verdicts: [
      { index: 9, role: 'buyer' },
      { index: 1, role: 'buyer' },
      { index: 1, role: 'maker' },
    ] }, 2)
    expect(out[0]?.role).toBe('buyer')
    expect(out[0]?.intent).toBeNull() // buyer with no intent specified → null
    expect(out[1]).toBeNull()
  })
  it('returns all-null for a non-array payload', () => {
    expect(normalizeBuyerVerdicts(null, 2)).toEqual([null, null])
  })
})
