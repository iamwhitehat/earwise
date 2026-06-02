import { describe, it, expect } from 'vitest'
import {
  isGenuineBuyer,
  buildBuyerIntentInput,
  normalizeBuyerVerdicts,
  buildNicheContext,
  nicheKey,
  buildSignalGateInput,
  normalizeSignalVerdicts,
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

describe('buildNicheContext', () => {
  it('joins non-empty parts and collapses whitespace', () => {
    expect(buildNicheContext(['AI support tools', null, '  founders  ', undefined])).toBe(
      'AI support tools · founders',
    )
  })
  it('is empty when there is nothing', () => {
    expect(buildNicheContext([null, '', '   '])).toBe('')
  })
})

describe('nicheKey', () => {
  it('is stable + case/space-insensitive, empty for empty', () => {
    expect(nicheKey('')).toBe('')
    expect(nicheKey('AI support tools')).toBe(nicheKey('  ai   support tools '))
  })
  it('differs for different niches', () => {
    expect(nicheKey('ai support tools')).not.toBe(nicheKey('e-commerce analytics'))
  })
})

describe('buildSignalGateInput', () => {
  it('prefixes the niche then the numbered items', () => {
    const out = buildSignalGateInput('AI support', [{ text: 'looking for a tool' }])
    expect(out).toContain("Founder's niche: AI support")
    expect(out).toContain('1. looking for a tool')
  })
  it('omits the niche line when empty', () => {
    expect(buildSignalGateInput('', [{ text: 'x' }]).startsWith('1.')).toBe(true)
  })
})

describe('normalizeSignalVerdicts', () => {
  it('maps buyer + on_niche per index, tolerant of junk', () => {
    const out = normalizeSignalVerdicts(
      { verdicts: [
        { index: 1, is_buyer: true, on_niche: true, confidence: 'high' },
        { index: 2, is_buyer: true, on_niche: false },
        { index: 9, is_buyer: true, on_niche: true },
      ] },
      2,
    )
    expect(out[0]).toEqual({ buyer: 'buyer', onNiche: true, confidence: 'high' })
    expect(out[1]).toEqual({ buyer: 'buyer', onNiche: false, confidence: 'medium' })
  })
  it('returns all-null for a non-array payload', () => {
    expect(normalizeSignalVerdicts(null, 2)).toEqual([null, null])
  })
})
