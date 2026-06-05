import { describe, it, expect } from 'vitest'
import { tsToMs, subredditFromUrl, mergeSignalsByPostId } from './signals-util'
import type { SignalRow } from './signals-db'

describe('tsToMs', () => {
  it('parses an ISO timestamp to epoch ms', () => {
    expect(tsToMs('2023-11-14T22:13:20.000Z')).toBe(Date.parse('2023-11-14T22:13:20.000Z'))
  })
  it('returns null for null/empty/garbage', () => {
    expect(tsToMs(null)).toBeNull()
    expect(tsToMs('')).toBeNull()
    expect(tsToMs('not a date')).toBeNull()
    expect(tsToMs(12345)).toBeNull()
  })
})

describe('subredditFromUrl', () => {
  it('extracts the subreddit from a Reddit permalink', () => {
    expect(subredditFromUrl('https://www.reddit.com/r/SaaS/comments/abc123/title/')).toBe('SaaS')
    expect(subredditFromUrl('https://reddit.com/r/indie_hackers/comments/x/')).toBe('indie_hackers')
  })
  it('returns null for non-Reddit or malformed urls', () => {
    expect(subredditFromUrl('https://news.ycombinator.com/item?id=1')).toBeNull()
    expect(subredditFromUrl('')).toBeNull()
    expect(subredditFromUrl('https://www.reddit.com/user/foo')).toBeNull()
  })
})

describe('mergeSignalsByPostId', () => {
  const mk = (kind: 'post' | 'comment', id: string): SignalRow => ({
    kind,
    id,
    post_id: id,
    subreddit: 'SaaS',
    author: 'u',
    text: 't',
    matchedPhrase: 'looking for',
    intentType: 'looking-for',
    category: 'pain_point',
    topic: null,
    analyzedAt: 0,
    permalink: `https://www.reddit.com/r/SaaS/comments/${id}/`,
  })

  it('keeps the first occurrence of each (kind,id) and preserves order', () => {
    const a = mk('post', 'a')
    const a2 = { ...mk('post', 'a'), author: 'dupe' }
    const b = mk('post', 'b')
    const merged = mergeSignalsByPostId([a, b], [a2, mk('post', 'c')])
    expect(merged.map((s) => s.id)).toEqual(['a', 'b', 'c'])
    expect(merged.find((s) => s.id === 'a')?.author).toBe('u') // first wins, not 'dupe'
  })

  it('treats a post and a comment with the same id as distinct', () => {
    const merged = mergeSignalsByPostId([mk('post', 'x')], [mk('comment', 'x')])
    expect(merged).toHaveLength(2)
  })
})
