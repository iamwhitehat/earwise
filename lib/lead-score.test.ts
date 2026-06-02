import { describe, it, expect } from 'vitest'
import { scoreLead, tierFor, scoreReason, SCORE_WEIGHTS } from './lead-score'

const NOW = 1_700_000_000_000
const day = (n: number) => NOW - n * 86_400_000

describe('scoreLead — intent ordering', () => {
  const base = { postedAt: NOW, icpFit: 0.5, engagement: 0, now: NOW }
  it('willing-to-pay > switching > looking-for > unknown', () => {
    const wtp = scoreLead({ ...base, intentType: 'willing-to-pay' }).score
    const sw = scoreLead({ ...base, intentType: 'switching' }).score
    const lf = scoreLead({ ...base, intentType: 'looking-for' }).score
    const unk = scoreLead({ ...base, intentType: null }).score
    expect(wtp).toBeGreaterThan(sw)
    expect(sw).toBeGreaterThan(lf)
    expect(lf).toBeGreaterThan(unk)
  })
})

describe('scoreLead — relevance factor', () => {
  const base = { intentType: 'looking-for' as const, postedAt: NOW, icpFit: 0.5, engagement: 0, now: NOW }
  it('on-niche outranks off-niche', () => {
    const on = scoreLead({ ...base, relevance: 1 })
    const off = scoreLead({ ...base, relevance: 0 })
    expect(on.score).toBeGreaterThan(off.score)
    expect(on.breakdown.relevance.points).toBe(Math.round(SCORE_WEIGHTS.relevance * 100))
    expect(off.breakdown.relevance.points).toBe(0)
  })
})

describe('scoreLead — recency decay', () => {
  const base = { intentType: 'willing-to-pay' as const, icpFit: 0.5, engagement: 0, now: NOW }
  it('fresh outranks aged outranks stale', () => {
    const fresh = scoreLead({ ...base, postedAt: day(0) })
    const twoWeeks = scoreLead({ ...base, postedAt: day(14) })
    const month = scoreLead({ ...base, postedAt: day(30) })
    expect(fresh.breakdown.recency.value).toBeCloseTo(1, 2)
    expect(twoWeeks.breakdown.recency.value).toBeCloseTo(Math.exp(-1), 2)
    expect(fresh.score).toBeGreaterThan(twoWeeks.score)
    expect(twoWeeks.score).toBeGreaterThan(month.score)
  })
  it('absent postedAt → neutral 0.5 recency', () => {
    expect(scoreLead({ ...base, postedAt: null }).breakdown.recency.value).toBe(0.5)
  })
})

describe('scoreLead — tiers', () => {
  it('tierFor thresholds', () => {
    expect(tierFor(70)).toBe('hot')
    expect(tierFor(69)).toBe('warm')
    expect(tierFor(40)).toBe('warm')
    expect(tierFor(39)).toBe('cold')
  })
  it('a willing-to-pay, fresh, strong-ICP lead is hot', () => {
    const s = scoreLead({ intentType: 'willing-to-pay', postedAt: NOW, icpFit: 1, engagement: 0.5, now: NOW })
    expect(s.tier).toBe('hot')
    expect(s.score).toBeGreaterThanOrEqual(70)
  })
  it('an old looking-for lead with no ICP is cold', () => {
    const s = scoreLead({ intentType: 'looking-for', postedAt: day(60), icpFit: 0, engagement: 0, now: NOW })
    expect(s.tier).toBe('cold')
  })
})

describe('scoreLead — defaults when factors absent', () => {
  it('icpFit defaults to 0.5, engagement to 0, relevance to 0.5', () => {
    const s = scoreLead({ intentType: 'switching', postedAt: NOW, now: NOW })
    expect(s.breakdown.icpFit.value).toBe(0.5)
    expect(s.breakdown.engagement.value).toBe(0)
    expect(s.breakdown.relevance.value).toBe(0.5)
  })
  it('clamps out-of-range inputs', () => {
    const s = scoreLead({ intentType: 'switching', postedAt: NOW, icpFit: 2, engagement: -1, now: NOW })
    expect(s.breakdown.icpFit.value).toBe(1)
    expect(s.breakdown.engagement.value).toBe(0)
  })
})

describe('scoreLead — breakdown + weights', () => {
  it('points reflect weight × value × 100', () => {
    const s = scoreLead({ intentType: 'willing-to-pay', relevance: 1, postedAt: NOW, icpFit: 1, engagement: 1, now: NOW })
    expect(s.breakdown.intent.points).toBe(Math.round(SCORE_WEIGHTS.intent * 1 * 100))
    expect(s.breakdown.relevance.points).toBe(Math.round(SCORE_WEIGHTS.relevance * 1 * 100))
    expect(s.score).toBe(100)
  })
  it('scoreReason names the strong factors', () => {
    const s = scoreLead({ intentType: 'willing-to-pay', postedAt: NOW, icpFit: 1, engagement: 0, now: NOW })
    expect(scoreReason(s)).toContain('intent')
    expect(scoreReason(s)).toContain('ICP fit')
  })
})
