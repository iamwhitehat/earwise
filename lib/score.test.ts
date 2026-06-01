import { describe, it, expect } from 'vitest'
import { scoreOpportunity, median, computeOpportunity } from './scan-types'
import type { TaggedPost } from './scan-types'

const base = { total: 20, subredditCount: 5, painCount: 12, featureCount: 4 }

describe('median', () => {
  it('handles empty, odd, even', () => {
    expect(median([])).toBe(0)
    expect(median([5])).toBe(5)
    expect(median([3, 1, 2])).toBe(2)
    expect(median([1, 2, 3, 4])).toBe(2.5)
  })
})

describe('scoreOpportunity engagement weighting', () => {
  it('contributes nothing when engagement is absent or zero', () => {
    const a = scoreOpportunity({ ...base })
    const b = scoreOpportunity({ ...base, engagement: 0 })
    expect(a.scoreRaw).toBe(b.scoreRaw)
  })

  it('raises the score when engagement is present (below the clamp)', () => {
    const without = scoreOpportunity({ ...base }).scoreRaw
    const withEng = scoreOpportunity({ ...base, engagement: 25 }).scoreRaw
    expect(withEng).toBeGreaterThan(without)
  })

  it('is monotonic non-decreasing in engagement', () => {
    const s0 = scoreOpportunity({ ...base, engagement: 0 }).scoreRaw
    const s1 = scoreOpportunity({ ...base, engagement: 10 }).scoreRaw
    const s2 = scoreOpportunity({ ...base, engagement: 100 }).scoreRaw
    expect(s1).toBeGreaterThanOrEqual(s0)
    expect(s2).toBeGreaterThanOrEqual(s1)
  })

  it('never exceeds 10', () => {
    const huge = scoreOpportunity({
      total: 5000,
      subredditCount: 80,
      painCount: 5000,
      featureCount: 0,
      engagement: 100000,
    })
    expect(huge.scoreRaw).toBeLessThanOrEqual(10)
    expect(huge.score).toBeLessThanOrEqual(10)
  })

  it('a tiny low-intent topic scores low; a big high-intent one scores high', () => {
    // 1 post, 1 sub, no pain/feature signal → only the small volume+spread terms.
    const tiny = scoreOpportunity({ total: 1, subredditCount: 1, painCount: 0, featureCount: 0 })
    expect(tiny.scoreRaw).toBeLessThan(2)
    const big = scoreOpportunity({ total: 80, subredditCount: 12, painCount: 60, featureCount: 12 })
    expect(big.scoreRaw).toBeGreaterThan(tiny.scoreRaw)
  })
})

describe('computeOpportunity', () => {
  function post(p: Partial<TaggedPost> & { topic: string | null }): TaggedPost {
    return {
      id: Math.random().toString(36).slice(2),
      title: 't',
      selftext: '',
      author: Math.random().toString(36).slice(2),
      is_self: false,
      permalink: '',
      category: 'pain_point',
      analyzedAt: Date.now(),
      tools: null,
      quotes: null,
      commentsScannedAt: null,
      commentsSampled: null,
      confidence: null,
      subreddit: 'SaaS',
      index: 0,
      ...p,
    }
  }

  it('groups by canonical topic and counts categories', () => {
    const posts = [
      post({ topic: 'auth problems', category: 'pain_point' }),
      post({ topic: 'authentication issues', category: 'feature_request' }), // canonical-merges
      post({ topic: 'pricing', category: 'tool_complaint' }),
    ]
    const opp = computeOpportunity(posts, 'auth problem')
    expect(opp.total).toBe(2)
    expect(opp.painCount).toBe(1)
    expect(opp.featureCount).toBe(1)
  })

  it('engagement is 0 when no post has comment data (score unchanged)', () => {
    const posts = [post({ topic: 'x', category: 'pain_point' })]
    const opp = computeOpportunity(posts, 'x')
    expect(opp.engagement).toBe(0)
    const baseline = scoreOpportunity({ total: 1, subredditCount: 1, painCount: 1, featureCount: 0 })
    expect(opp.scoreRaw).toBe(baseline.scoreRaw)
  })

  it('uses sampled comments as engagement when present', () => {
    const posts = [
      post({ topic: 'x', category: 'pain_point', commentsSampled: 18 }),
      post({ topic: 'x', category: 'pain_point', commentsSampled: 12 }),
    ]
    const opp = computeOpportunity(posts, 'x')
    expect(opp.engagement).toBe(15) // median(18,12)
  })
})
