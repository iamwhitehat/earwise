import { describe, it, expect } from 'vitest'
import {
  prepareCandidates,
  shortlistForClassification,
  rankBuyers,
  type FindCandidate,
} from './try-find'
import type { RawSignal } from './sources/types'
import type { BuyerIntentResult } from './buyer-intent'

function sig(over: Partial<RawSignal>): RawSignal {
  return {
    source: 'reddit',
    externalId: over.externalId ?? 'id',
    title: over.title ?? '',
    body: over.body ?? '',
    author: over.author ?? 'u',
    url: over.url ?? 'https://reddit.com/x',
    createdAt: over.createdAt ?? null,
    engagement: {},
  }
}

const buyer: BuyerIntentResult = { role: 'buyer', isBuyer: true, confidence: 'high', intent: null }
const notBuyer: BuyerIntentResult = { role: 'discussion', isBuyer: false, confidence: 'low', intent: null }

describe('prepareCandidates', () => {
  it('drops obvious makers via the pre-flag', () => {
    const out = prepareCandidates(
      [
        sig({ externalId: 'a', title: 'I built a CRM, check out my app' }),
        sig({ externalId: 'b', title: 'looking for a CRM that does X' }),
      ],
      'SaaS',
    )
    expect(out.map((c) => c.externalId)).toEqual(['b'])
  })

  it('tags the intent phrase + type and stamps the subreddit', () => {
    const [c] = prepareCandidates([sig({ title: 'anyone recommend a tool for invoicing' })], 'SaaS')
    expect(c.matchedPhrase).toBe('recommend a')
    expect(c.patternIntent).toBe('looking-for')
    expect(c.subreddit).toBe('SaaS')
  })

  it('skips empty posts', () => {
    expect(prepareCandidates([sig({ title: '', body: '' })], 'SaaS')).toHaveLength(0)
  })
})

describe('shortlistForClassification', () => {
  it('floats phrase-matched candidates above unmatched, then caps', () => {
    const cands: FindCandidate[] = [
      { externalId: 'plain', title: '', text: 'just chatting', author: 'u', subreddit: 's', permalink: '', createdAt: 100, matchedPhrase: null, patternIntent: null },
      { externalId: 'match', title: '', text: 'looking for x', author: 'u', subreddit: 's', permalink: '', createdAt: 1, matchedPhrase: 'looking for', patternIntent: 'looking-for' },
    ]
    const out = shortlistForClassification(cands, 1)
    expect(out).toHaveLength(1)
    expect(out[0].externalId).toBe('match') // matched wins despite being older
  })

  it('breaks ties by recency among unmatched', () => {
    const mk = (id: string, createdAt: number): FindCandidate => ({
      externalId: id, title: '', text: 't', author: 'u', subreddit: 's', permalink: '', createdAt, matchedPhrase: null, patternIntent: null,
    })
    const out = shortlistForClassification([mk('old', 1), mk('new', 999)], 1)
    expect(out[0].externalId).toBe('new')
  })
})

describe('rankBuyers', () => {
  const cand = (over: Partial<FindCandidate>): FindCandidate => ({
    externalId: 'id', title: 't', text: 'body', author: 'u', subreddit: 's',
    permalink: 'p', createdAt: null, matchedPhrase: null, patternIntent: null, ...over,
  })

  it('keeps only genuine buyers', () => {
    const out = rankBuyers([
      { candidate: cand({ externalId: 'a' }), verdict: buyer },
      { candidate: cand({ externalId: 'b' }), verdict: notBuyer },
      { candidate: cand({ externalId: 'c' }), verdict: null },
    ])
    expect(out.map((b) => b.externalId)).toEqual(['a'])
  })

  it('ranks willing-to-pay above looking-for', () => {
    const out = rankBuyers([
      { candidate: cand({ externalId: 'weak' }), verdict: { ...buyer, intent: 'looking-for' } },
      { candidate: cand({ externalId: 'strong' }), verdict: { ...buyer, intent: 'willing-to-pay' } },
    ])
    expect(out[0].externalId).toBe('strong')
  })

  it('prefers the classifier intent over the matched phrase, and builds a why line', () => {
    const out = rankBuyers([
      { candidate: cand({ matchedPhrase: 'looking for', patternIntent: 'looking-for' }), verdict: { ...buyer, intent: 'willing-to-pay' } },
    ])
    expect(out[0].intentType).toBe('willing-to-pay')
    expect(out[0].why).toContain('willing to pay')
    expect(out[0].why).toContain('looking for') // the phrase that flagged them
  })

  it('honors the limit', () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ candidate: cand({ externalId: String(i) }), verdict: buyer }))
    expect(rankBuyers(items, { limit: 3 })).toHaveLength(3)
  })
})
