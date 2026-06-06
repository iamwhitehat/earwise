import { describe, it, expect } from 'vitest'
import { rawEngagement, percentileRank, percentilesOf } from './score-norm'

describe('rawEngagement', () => {
  it('combines score + half of comments, floors negatives/missing to 0', () => {
    expect(rawEngagement({ score: 10 })).toBe(10)
    expect(rawEngagement({ comments: 4 })).toBe(2)
    expect(rawEngagement({ score: 10, comments: 4 })).toBe(12)
    expect(rawEngagement({})).toBe(0)
    expect(rawEngagement(undefined)).toBe(0)
    expect(rawEngagement({ score: -5, comments: -2 })).toBe(0)
  })
})

describe('percentileRank', () => {
  it('ranks within the group: top → 1, bottom/ties → 0', () => {
    expect(percentileRank(3, [0, 1, 2, 3])).toBe(1)
    expect(percentileRank(0, [0, 0, 0])).toBe(0)
    expect(percentileRank(2, [0, 1, 2, 3])).toBeCloseTo(2 / 3, 6)
  })
  it('returns 0 for groups too small to rank', () => {
    expect(percentileRank(5, [5])).toBe(0)
    expect(percentileRank(5, [])).toBe(0)
  })
})

describe('percentilesOf', () => {
  it('maps an ascending group to evenly-spaced ranks ending at 1', () => {
    expect(percentilesOf([1, 2, 3, 4])).toEqual([0, 1 / 3, 2 / 3, 1])
  })
  it('zero-engagement group (Reddit RSS) is all 0 → engagement-neutral', () => {
    expect(percentilesOf([0, 0, 0])).toEqual([0, 0, 0])
  })
  it('ties share the lower rank', () => {
    expect(percentilesOf([5, 5, 10])).toEqual([0, 0, 1])
  })
  it('is scale-invariant: a small-scale and a large-scale source rank identically', () => {
    // The core cross-source fix: HN points (1000s) and SO scores (10s) with the
    // same *shape* yield the same normalized distribution.
    const small = percentilesOf([1, 2, 3])
    const large = percentilesOf([100, 500, 1000])
    expect(large).toEqual(small)
  })
})
