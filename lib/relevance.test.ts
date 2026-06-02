import { describe, it, expect } from 'vitest'
import {
  relevanceFromCosine,
  relevanceFromVerdict,
  qualifiesRelevance,
  buildNicheText,
  buildRelevanceInput,
  normalizeRelevanceVerdicts,
  DEFAULT_RELEVANCE_TAU,
} from './relevance'

describe('relevance scoring helpers', () => {
  it('clamps cosine to 0..1', () => {
    expect(relevanceFromCosine(0.73)).toBeCloseTo(0.73)
    expect(relevanceFromCosine(-0.2)).toBe(0)
    expect(relevanceFromCosine(1.4)).toBe(1)
  })
  it('maps yes/no verdicts above/below the threshold', () => {
    expect(qualifiesRelevance(relevanceFromVerdict(true))).toBe(true)
    expect(qualifiesRelevance(relevanceFromVerdict(false))).toBe(false)
  })
  it('qualifies at/above tau', () => {
    expect(qualifiesRelevance(0.6)).toBe(true)
    expect(qualifiesRelevance(0.59)).toBe(false)
    expect(qualifiesRelevance(0.5, 0.4)).toBe(true)
    expect(DEFAULT_RELEVANCE_TAU).toBe(0.6)
  })
})

describe('buildNicheText', () => {
  it('joins non-empty parts and caps length', () => {
    expect(buildNicheText(['AI support tools', null, 'auto-triage tickets', '  '])).toBe(
      'AI support tools. auto-triage tickets',
    )
    expect(buildNicheText([]).length).toBe(0)
    expect(buildNicheText(['x'.repeat(2000)]).length).toBeLessThanOrEqual(800)
  })
})

describe('buildRelevanceInput', () => {
  it('prefixes the niche then numbers items', () => {
    const out = buildRelevanceInput('AI support tools', [{ text: 'EU sock manufacturer here' }])
    expect(out).toContain("Founder's niche + product: AI support tools")
    expect(out).toContain('1. EU sock manufacturer here')
  })
})

describe('normalizeRelevanceVerdicts', () => {
  it('maps relevant + reason per index, tolerant of junk', () => {
    const out = normalizeRelevanceVerdicts(
      { verdicts: [
        { index: 1, relevant: true, reason: 'about AI support' },
        { index: 2, relevant: false, reason: 'sock manufacturing, off-niche' },
        { index: 9, relevant: true },
      ] },
      2,
    )
    expect(out[0]).toEqual({ relevant: true, reason: 'about AI support' })
    expect(out[1]).toEqual({ relevant: false, reason: 'sock manufacturing, off-niche' })
  })
  it('returns all-null for a non-array payload', () => {
    expect(normalizeRelevanceVerdicts(null, 2)).toEqual([null, null])
  })
})
