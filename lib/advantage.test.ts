import { describe, it, expect } from 'vitest'
import {
  computeDemand,
  computeMomentum,
  computeFitToYou,
  computeAdvantage,
  normalizeWeights,
  DEFAULT_ADVANTAGE_WEIGHTS,
} from './advantage'

describe('computeDemand', () => {
  it('returns 0..1 and rises with volume/authors/engagement/breadth', () => {
    const low = computeDemand({ posts: 1, uniqueAuthors: 1, engagement: 0, sourceBreadth: 1 })
    const high = computeDemand({ posts: 100, uniqueAuthors: 50, engagement: 500, sourceBreadth: 3 })
    expect(low).toBeGreaterThanOrEqual(0)
    expect(high).toBeLessThanOrEqual(1)
    expect(high).toBeGreaterThan(low)
  })
  it('is monotonic in posts and in source breadth', () => {
    const base = { posts: 10, uniqueAuthors: 5, engagement: 10, sourceBreadth: 1 }
    expect(computeDemand({ ...base, posts: 40 })).toBeGreaterThan(computeDemand(base))
    expect(computeDemand({ ...base, sourceBreadth: 3 })).toBeGreaterThan(computeDemand(base))
  })
})

describe('computeMomentum', () => {
  it('maps directions to a 0..1 band', () => {
    expect(computeMomentum([1, 2, 4])).toBe(1) // accelerating
    expect(computeMomentum([])).toBeCloseTo(0.45) // new (no history)
    const declining = computeMomentum([10, 8, 5])
    expect(declining).toBeLessThan(0.5)
  })
})

describe('computeFitToYou', () => {
  it('is neutral (0.5) when memory is empty', () => {
    expect(computeFitToYou('', 'auth billing problems')).toBe(0.5)
  })
  it('rewards overlap between memory and opportunity', () => {
    const fit = computeFitToYou('stripe billing payments saas', 'billing dunning for saas founders')
    const none = computeFitToYou('woodworking gardening', 'billing dunning for saas founders')
    expect(fit).toBeGreaterThan(none)
    expect(none).toBe(0)
  })
  it('stays within 0..1', () => {
    const f = computeFitToYou('a b c d e f g billing', 'billing billing billing')
    expect(f).toBeGreaterThanOrEqual(0)
    expect(f).toBeLessThanOrEqual(1)
  })
})

describe('computeAdvantage', () => {
  const full = { demand: 1, monetization: 1, momentum: 1, whitespace: 1, fitToYou: 1 }
  const none = { demand: 0, monetization: 0, momentum: 0, whitespace: 0, fitToYou: 0 }

  it('all-ones → 1, all-zeros → 0', () => {
    expect(computeAdvantage(full).score).toBeCloseTo(1)
    expect(computeAdvantage(none).score).toBeCloseTo(0)
  })
  it('contributions sum to the score', () => {
    const r = computeAdvantage({ demand: 0.8, monetization: 0.5, momentum: 0.6, whitespace: 0.4, fitToYou: 0.7 })
    const sum =
      r.contributions.demand +
      r.contributions.monetization +
      r.contributions.momentum +
      r.contributions.whitespace +
      r.contributions.fitToYou
    expect(sum).toBeCloseTo(r.score)
  })
  it('respects weights — zeroing a weight drops that contribution', () => {
    const w = { ...DEFAULT_ADVANTAGE_WEIGHTS, fitToYou: 0 }
    const r = computeAdvantage({ demand: 0, monetization: 0, momentum: 0, whitespace: 0, fitToYou: 1 }, w)
    expect(r.score).toBeCloseTo(0)
  })
  it('clamps out-of-range component values', () => {
    const r = computeAdvantage({ demand: 5, monetization: -3, momentum: 0.5, whitespace: 2, fitToYou: 0.5 })
    expect(r.score).toBeGreaterThanOrEqual(0)
    expect(r.score).toBeLessThanOrEqual(1)
  })
})

describe('normalizeWeights', () => {
  it('fills invalid/missing fields with defaults', () => {
    const w = normalizeWeights({ demand: 0.5, monetization: -1, momentum: 'x' })
    expect(w.demand).toBe(0.5)
    expect(w.monetization).toBe(DEFAULT_ADVANTAGE_WEIGHTS.monetization)
    expect(w.momentum).toBe(DEFAULT_ADVANTAGE_WEIGHTS.momentum)
  })
})
