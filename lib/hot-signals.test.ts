import { describe, it, expect } from 'vitest'
import {
  scoreSignal,
  rankHotSignals,
  isFreshEnoughToReply,
  MAX_REPLY_AGE_MS,
  type HotSignal,
} from './hot-signals'
import type { SignalRow } from './signals-db'

const NOW = 1_700_000_000_000

function sig(over: Partial<SignalRow>): SignalRow {
  return {
    kind: 'post',
    id: 'a',
    post_id: 'a',
    subreddit: 'SaaS',
    author: 'u',
    text: 'looking for a tool',
    matchedPhrase: 'looking for',
    intentType: 'looking-for',
    category: 'pain_point',
    topic: null,
    analyzedAt: NOW,
    permalink: 'https://www.reddit.com/r/SaaS/comments/a/',
    ...over,
  }
}

const EMPTY_BREAKDOWN = {
  intent: { value: 0, points: 0 },
  relevance: { value: 0, points: 0 },
  recency: { value: 0, points: 0 },
  icpFit: { value: 0, points: 0 },
  engagement: { value: 0, points: 0 },
}
const hot = (over: Partial<HotSignal>): HotSignal => ({
  ...sig({}),
  score: 50,
  tier: 'warm',
  breakdown: EMPTY_BREAKDOWN,
  ...over,
})

describe('scoreSignal', () => {
  it('willing-to-pay + fresh + strong ICP + on-niche scores hot', () => {
    const s = scoreSignal(sig({ intentType: 'willing-to-pay', analyzedAt: NOW }), 1, 1, NOW)
    expect(s.tier).toBe('hot')
    expect(s.score).toBeGreaterThanOrEqual(70)
  })
  it('old looking-for with no ICP + off-niche scores cold', () => {
    const s = scoreSignal(sig({ intentType: 'looking-for', analyzedAt: NOW - 60 * 86_400_000 }), 0, 0, NOW)
    expect(s.tier).toBe('cold')
  })
  it('carries the relevance factor in the breakdown', () => {
    const s = scoreSignal(sig({ intentType: 'looking-for', analyzedAt: NOW }), 0.5, 0.8, NOW)
    expect(s.breakdown.relevance.value).toBeCloseTo(0.8)
  })
  it('recency uses true postedAt, not scan time — a stale thread scanned now scores low', () => {
    // Scanned this instant (analyzedAt = NOW) but actually posted 60 days ago.
    const stale = scoreSignal(
      sig({ intentType: 'willing-to-pay', analyzedAt: NOW, postedAt: NOW - 60 * 86_400_000 }),
      1,
      1,
      NOW,
    )
    const fresh = scoreSignal(
      sig({ intentType: 'willing-to-pay', analyzedAt: NOW, postedAt: NOW }),
      1,
      1,
      NOW,
    )
    expect(stale.breakdown.recency.value).toBeLessThan(fresh.breakdown.recency.value)
    expect(stale.score).toBeLessThan(fresh.score)
  })
  it('falls back to analyzedAt when postedAt is unknown', () => {
    const withPosted = scoreSignal(sig({ analyzedAt: NOW, postedAt: NOW }), 0.5, 0.5, NOW)
    const noPosted = scoreSignal(sig({ analyzedAt: NOW }), 0.5, 0.5, NOW) // postedAt undefined
    expect(noPosted.breakdown.recency.value).toBeCloseTo(withPosted.breakdown.recency.value)
  })
})

describe('isFreshEnoughToReply', () => {
  const NOW2 = 1_700_000_000_000
  it('allows a post inside the reply window', () => {
    expect(isFreshEnoughToReply({ postedAt: NOW2 - 1 * 3600_000 }, MAX_REPLY_AGE_MS, NOW2)).toBe(true)
  })
  it('rejects a post past the reply window', () => {
    expect(isFreshEnoughToReply({ postedAt: NOW2 - 72 * 3600_000 }, MAX_REPLY_AGE_MS, NOW2)).toBe(false)
  })
  it('does not gate when the true age is unknown (null)', () => {
    expect(isFreshEnoughToReply({ postedAt: null }, MAX_REPLY_AGE_MS, NOW2)).toBe(true)
    expect(isFreshEnoughToReply({}, MAX_REPLY_AGE_MS, NOW2)).toBe(true)
  })
})

describe('rankHotSignals', () => {
  it('sorts by score desc, recency breaks ties, and applies the threshold + limit', () => {
    const a = hot({ id: 'a', score: 90, analyzedAt: NOW - 1000 })
    const b = hot({ id: 'b', score: 90, analyzedAt: NOW }) // same score, fresher → first
    const c = hot({ id: 'c', score: 55 })
    const d = hot({ id: 'd', score: 20 }) // below threshold
    const ranked = rankHotSignals([a, c, d, b], { minScore: 40, limit: 5 })
    expect(ranked.map((s) => s.id)).toEqual(['b', 'a', 'c'])
  })
  it('limit trims to N', () => {
    const many = Array.from({ length: 10 }, (_, i) => hot({ id: String(i), score: 80 - i }))
    expect(rankHotSignals(many, { limit: 3 })).toHaveLength(3)
  })
})
