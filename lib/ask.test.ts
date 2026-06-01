import { describe, it, expect } from 'vitest'
import { extractKeywords, rankSources, buildAskUserContent, type MarketSource } from './ask'

describe('extractKeywords', () => {
  it('drops stopwords + short tokens and dedupes', () => {
    expect(extractKeywords('What are people saying about pricing and pricing tiers?')).toEqual([
      'pricing',
      'tiers',
    ])
  })
  it('returns empty for a contentless query', () => {
    expect(extractKeywords('what are they?')).toEqual([])
  })
  it('caps the keyword count', () => {
    const q = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet'
    expect(extractKeywords(q).length).toBeLessThanOrEqual(8)
  })
})

const src = (over: Partial<MarketSource>): MarketSource => ({
  title: '',
  snippet: '',
  url: 'https://x',
  author: 'u',
  subreddit: 'SaaS',
  source: 'reddit',
  ...over,
})

describe('rankSources', () => {
  it('weights title hits above body hits and drops zero-hit sources', () => {
    const a = src({ title: 'Zendesk pricing pain', snippet: 'unrelated' }) // title hit
    const b = src({ title: 'general', snippet: 'mentions pricing once' }) // body hit
    const c = src({ title: 'nothing', snippet: 'nothing here' }) // no hit
    const ranked = rankSources([b, c, a], ['pricing'])
    expect(ranked).toHaveLength(2)
    expect(ranked[0]).toBe(a)
    expect(ranked[1]).toBe(b)
  })
  it('respects the limit', () => {
    const many = Array.from({ length: 20 }, (_, i) => src({ title: `pricing ${i}` }))
    expect(rankSources(many, ['pricing'], 5)).toHaveLength(5)
  })
})

describe('buildAskUserContent', () => {
  it('numbers evidence and includes the question', () => {
    const out = buildAskUserContent('why churn?', [src({ title: 'Churn is high', subreddit: 'SaaS' })])
    expect(out).toContain('Question: why churn?')
    expect(out).toContain('[1] (r/SaaS, u/u) Churn is high')
  })
})
