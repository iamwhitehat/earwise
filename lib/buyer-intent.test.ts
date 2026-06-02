import { describe, it, expect } from 'vitest'
import {
  isGenuineBuyer,
  buildBuyerIntentInput,
  normalizeBuyerVerdicts,
} from './buyer-intent'

describe('isGenuineBuyer', () => {
  it('passes only the buyer verdict', () => {
    expect(isGenuineBuyer('buyer')).toBe(true)
    expect(isGenuineBuyer('not_buyer')).toBe(false)
    expect(isGenuineBuyer(null)).toBe(false)
    expect(isGenuineBuyer(undefined)).toBe(false)
  })
})

describe('buildBuyerIntentInput', () => {
  it('numbers items 1-based and collapses whitespace', () => {
    const out = buildBuyerIntentInput([{ text: 'looking   for\n a tool' }, { text: 'would pay' }])
    expect(out).toContain('1. looking for a tool')
    expect(out).toContain('2. would pay')
  })
  it('caps long text', () => {
    const out = buildBuyerIntentInput([{ text: 'x'.repeat(2000) }])
    expect(out.length).toBeLessThan(700)
  })
})

describe('normalizeBuyerVerdicts', () => {
  it('aligns verdicts to input order by index', () => {
    const raw = { verdicts: [
      { index: 2, is_buyer: false, confidence: 'high' },
      { index: 1, is_buyer: true },
    ] }
    const out = normalizeBuyerVerdicts(raw, 2)
    expect(out[0]).toEqual({ verdict: 'buyer', confidence: 'medium' }) // default conf
    expect(out[1]).toEqual({ verdict: 'not_buyer', confidence: 'high' })
  })
  it('ignores out-of-range / duplicate indexes and tolerates junk', () => {
    const out = normalizeBuyerVerdicts({ verdicts: [
      { index: 5, is_buyer: true }, // out of range
      { index: 1, is_buyer: true },
      { index: 1, is_buyer: false }, // duplicate → first wins
    ] }, 2)
    expect(out[0]?.verdict).toBe('buyer')
    expect(out[1]).toBeNull()
  })
  it('returns all-null for a non-array payload', () => {
    expect(normalizeBuyerVerdicts(null, 3)).toEqual([null, null, null])
    expect(normalizeBuyerVerdicts({ verdicts: 'nope' }, 1)).toEqual([null])
  })
})
