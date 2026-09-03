import { describe, it, expect } from 'vitest'
import {
  normalizeFact,
  factFingerprint,
  dedupeFacts,
  normalizeCuratedFacts,
  CURATED_KINDS,
  type CuratedFact,
} from './knowledge'
import type { MemoryFact } from './memory'

describe('normalizeFact', () => {
  it('collapses runs of whitespace and trims', () => {
    expect(normalizeFact('  founders   struggle   with\nonboarding ')).toBe('founders struggle with onboarding')
  })
})

describe('factFingerprint', () => {
  it('is case-insensitive', () => {
    expect(factFingerprint('Admins Hate Their CRM')).toBe(factFingerprint('admins hate their crm'))
  })
  it('caps long facts to a stable prefix', () => {
    const long = 'a'.repeat(200)
    expect(factFingerprint(long).length).toBe(72)
  })
})

describe('dedupeFacts', () => {
  const mem: MemoryFact[] = [{ kind: 'gap', fact: 'freelancers lack a cheap contract tracker', weight: 1 }]

  it('drops a fact already in memory', () => {
    const c: CuratedFact[] = [{ kind: 'gap', fact: '  freelancers lack a cheap   contract tracker ', weight: 1 }]
    expect(dedupeFacts(c, mem)).toEqual([])
  })

  it('drops duplicates within the batch too', () => {
    const c: CuratedFact[] = [
      { kind: 'gap', fact: 'new idea here', weight: 1 },
      { kind: 'gap', fact: 'new idea here', weight: 1.5 },
    ]
    expect(dedupeFacts(c, mem)).toHaveLength(1)
  })

  it('keeps genuinely new facts', () => {
    const c: CuratedFact[] = [{ kind: 'market_pain', fact: 'admins hate manual invoice chasing', weight: 1 }]
    expect(dedupeFacts(c, mem)).toHaveLength(1)
  })
})

describe('normalizeCuratedFacts', () => {
  it('keeps valid facts and clamps weight into 0.5..2', () => {
    const out = normalizeCuratedFacts([
      { kind: 'gap', fact: 'a real gap', weight: 99 },
      { kind: 'market_pain', fact: 'a real pain', weight: 0.01, evidence: 'r/somewhere' },
    ])
    expect(out).toHaveLength(2)
    expect(out[0].weight).toBe(2)
    expect(out[1].weight).toBe(0.5)
  })

  it('drops unknown kinds, empty facts, and non-array input', () => {
    expect(normalizeCuratedFacts(null)).toEqual([])
    expect(
      normalizeCuratedFacts([{ kind: 'nonsense', fact: 'x' }, { kind: 'gap', fact: '   ' }]),
    ).toEqual([])
  })

  it('sorts highest-weight first and caps the batch', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ kind: 'gap', fact: `fact ${i}`, weight: 1 + (i % 3) * 0.5 }))
    const out = normalizeCuratedFacts(many)
    expect(out).toHaveLength(25)
    expect(out[0].weight).toBe(2)
  })

  it('every curated kind is in the allowed set', () => {
    expect(CURATED_KINDS).toHaveLength(5)
    expect(new Set(CURATED_KINDS).size).toBe(5)
  })
})
