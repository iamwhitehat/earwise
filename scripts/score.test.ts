import { describe, it, expect } from 'vitest'
import {
  scoreTopics,
  evidenceConfidence,
  shrinkToNeutral,
  looksLikeDemand,
  willingToPay,
  profitability,
  type Classified,
} from './scan-core'
import type { RawSignal } from '../lib/sources/types'

// --- fixtures -------------------------------------------------------------

let seq = 0
function sig(source = 'reddit'): RawSignal {
  seq++
  return {
    source,
    externalId: `t${seq}`,
    title: `post ${seq}`,
    body: '',
    author: 'u',
    url: `https://x/${seq}`,
    createdAt: null,
    engagement: {},
  }
}

function row(
  category: Classified['category'],
  topic: string,
  tools: string[],
  dissatisfied: boolean,
): { signal: RawSignal; c: Classified } {
  return { signal: sig(), c: { category, topic, tools, dissatisfied } }
}

// --- the core regression: "no tool named" is not "unmet" -----------------

describe('scoreTopics — unanswered demand semantics', () => {
  it('a seeker who names no tool but is NOT dissatisfied is not unmet', () => {
    // Two people asking "what do you use for X" — no tool, no complaint.
    const { scored } = scoreTopics([row('pain_point', 'x', [], false), row('pain_point', 'x', [], false)], 1)
    expect(scored[0].unanswered).toBe(0)
    // Demand still counts — they did voice a need.
    expect(scored[0].demand).toBe(2)
  })

  it('a dissatisfied seeker who names no tool IS unmet', () => {
    const { scored } = scoreTopics([row('pain_point', 'x', [], true), row('pain_point', 'x', [], true)], 1)
    expect(scored[0].unanswered).toBe(2)
  })

  it('a seeker who names a tool is not unmet, even if dissatisfied', () => {
    const { scored } = scoreTopics([row('pain_point', 'x', ['Asana'], true), row('pain_point', 'x', ['Asana'], true)], 1)
    expect(scored[0].unanswered).toBe(0)
  })
})

describe('scoreTopics — refutation feeds saturation', () => {
  it('a refuted topic scores lower than the same topic unrefuted', () => {
    const rows = [row('pain_point', 'x', [], true), row('pain_point', 'x', [], true)]
    const plain = scoreTopics(rows, 1).scored[0]
    const refuted = scoreTopics(rows, 1, { x: ['Incumbent A', 'Incumbent B'] }).scored[0]
    // The raw "dissatisfied and no tool" count is preserved — it is a fact about
    // the posts. Refutation changes the SCORE (saturation), not the count.
    expect(refuted.unanswered).toBe(2)
    expect(refuted.whitespace).toBeLessThan(plain.whitespace)
    expect(refuted.refutedBy).toEqual(['Incumbent A', 'Incumbent B'])
  })
})

describe('evidence shrinkage', () => {
  it('confidence is 0 at no posts and 0.5 at K posts', () => {
    expect(evidenceConfidence(0)).toBe(0)
    expect(evidenceConfidence(6)).toBeCloseTo(0.5)
  })
  it('shrinkToNeutral pulls toward 0.5 for thin evidence', () => {
    const shrunk = shrinkToNeutral(1.0, 1) // 1 post → confidence 1/7
    expect(shrunk).toBeGreaterThan(0.5)
    expect(shrunk).toBeLessThan(1.0)
  })
})

describe('looksLikeDemand — the deterministic pre-filter', () => {
  it('a negated ask is not demand', () => {
    expect(looksLikeDemand({ ...sig(), title: 'not looking for a new tool' })).toBe(false)
  })
  it('self-promo is not demand', () => {
    expect(looksLikeDemand({ ...sig(), title: 'just launched my app — feedback welcome' })).toBe(false)
  })
  it('a plain recommendation ask is demand', () => {
    expect(looksLikeDemand({ ...sig(), title: 'any recommendations for a CRM?' })).toBe(true)
  })
})

describe('willingToPay — the profit signal', () => {
  it('detects an explicit price statement', () => {
    expect(willingToPay({ ...sig(), title: 'willing to pay $50/mo for this' })).toBe(true)
    expect(willingToPay({ ...sig(), title: 'I would pay for a tool that does X' })).toBe(true)
  })
  it('does not fire on a plain recommendation ask', () => {
    expect(willingToPay({ ...sig(), title: 'any recommendations for a CRM?' })).toBe(false)
  })
})

describe('profitability — composite worth-building score', () => {
  it('is higher with willingness-to-pay than without', () => {
    const withWtp = profitability(10, 10, 5, 2, 0.5, true)
    const noWtp = profitability(10, 10, 0, 2, 0.5, true)
    expect(withWtp).toBeGreaterThan(noWtp)
  })
  it('is bounded 0..1', () => {
    expect(profitability(1000, 1000, 1000, 1000, 1, true)).toBeLessThanOrEqual(1)
    expect(profitability(0, 0, 0, 0, 0, false)).toBeGreaterThanOrEqual(0)
  })
})
