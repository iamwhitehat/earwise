import { describe, it, expect } from 'vitest'
import { selectPublicBuyers } from './public-scan'
import type { RawSignal } from './sources/types'

const NOW = 1_700_000_000_000

function post(id: string, title: string, body: string, createdAt: number | null = NOW): RawSignal {
  return {
    source: 'reddit',
    externalId: id,
    title,
    body,
    author: `user_${id}`,
    url: `https://www.reddit.com/r/test/comments/${id}/`,
    createdAt,
    engagement: {},
  }
}

describe('selectPublicBuyers', () => {
  it('keeps phrase-matched buyers, drops non-buyers, caps to the limit', () => {
    const raw = [
      post('a', 'Looking for a CRM for freelancers', 'anyone got recommendations?'),
      post('b', 'Need an alternative to Mailchimp', 'too expensive now'),
      post('c', "I'd pay for a tool that schedules posts", 'willing to pay monthly'),
      post('d', 'Anyone know a tool for invoicing?', 'looking for something simple'),
      post('e', 'Just shipped my weekend project', 'sharing some thoughts'), // no buyer phrase
    ]
    const { buyers, totalBuyers } = selectPublicBuyers([{ raw, subreddit: 'test' }], { now: NOW, limit: 3 })
    expect(totalBuyers).toBe(4) // a, b, c, d match buying phrases; e does not
    expect(buyers).toHaveLength(3) // capped
    for (const b of buyers) {
      expect(['a', 'b', 'c', 'd']).toContain(b.externalId)
      expect(b.subreddit).toBe('test')
      expect(b.why).toBeTruthy()
    }
  })

  it('returns no buyers when nothing matches a buying phrase', () => {
    const raw = [
      post('x', 'Show HN: my new side project', 'feedback welcome'),
      post('y', 'Thoughts on remote work', 'discussion thread'),
    ]
    const { buyers, totalBuyers } = selectPublicBuyers([{ raw, subreddit: 'test' }], { now: NOW })
    expect(totalBuyers).toBe(0)
    expect(buyers).toHaveLength(0)
  })

  it('aggregates across multiple subreddits and stamps each buyer with its sub', () => {
    const a = [post('a1', 'Looking for a Shopify dev', 'need help')]
    const b = [post('b1', 'Looking for a WordPress plugin', 'willing to pay')]
    const { buyers, totalBuyers } = selectPublicBuyers(
      [{ raw: a, subreddit: 'shopify' }, { raw: b, subreddit: 'wordpress' }],
      { now: NOW, limit: 5 },
    )
    expect(totalBuyers).toBe(2)
    const subs = buyers.map((x) => x.subreddit).sort()
    expect(subs).toEqual(['shopify', 'wordpress'])
  })
})
