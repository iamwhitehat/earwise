import { describe, it, expect } from 'vitest'
import { normalizeTitle, postDedupeKey, dedupePosts, countDuplicates } from './dedup'

describe('normalizeTitle', () => {
  it('lowercases, strips punctuation + urls + stopwords', () => {
    expect(normalizeTitle('How do I fix the Auth bug?? https://x.co/a')).toBe('fix auth bug')
  })
  it('collapses whitespace', () => {
    expect(normalizeTitle('  multiple    spaces  ')).toBe('multiple spaces')
  })
})

describe('postDedupeKey', () => {
  it('same normalized title + author collapse', () => {
    expect(postDedupeKey('My Auth Problem', 'jane')).toBe(
      postDedupeKey('my auth problem!', 'Jane'),
    )
  })
  it('different authors do not collapse', () => {
    expect(postDedupeKey('same title', 'a')).not.toBe(postDedupeKey('same title', 'b'))
  })
  it('unknown/deleted authors key on title alone', () => {
    expect(postDedupeKey('x', 'unknown')).toBe(postDedupeKey('x', '[deleted]'))
    expect(postDedupeKey('x', 'unknown')).toBe('::x')
  })
})

describe('dedupePosts', () => {
  it('removes crossposts (same author + title across subs), keeping the first', () => {
    const posts = [
      { title: 'Need a CRM', author: 'jane', subreddit: 'SaaS' },
      { title: 'need a crm!', author: 'jane', subreddit: 'startups' }, // crosspost
      { title: 'Need a CRM', author: 'bob', subreddit: 'SaaS' }, // different person -> kept
    ]
    const out = dedupePosts(posts)
    expect(out).toHaveLength(2)
    expect(out[0].subreddit).toBe('SaaS')
    expect(out[1].author).toBe('bob')
  })

  it('is stable / order-preserving', () => {
    const posts = [
      { title: 'a', author: 'x' },
      { title: 'b', author: 'y' },
      { title: 'a', author: 'x' },
    ]
    expect(dedupePosts(posts).map((p) => p.title)).toEqual(['a', 'b'])
  })

  it('passes through empty-title rows without collapsing them', () => {
    const posts = [
      { title: '', author: 'x' },
      { title: '', author: 'x' },
    ]
    expect(dedupePosts(posts)).toHaveLength(2)
  })

  it('countDuplicates reports the drop count', () => {
    const posts = [
      { title: 'dup', author: 'a' },
      { title: 'dup', author: 'a' },
      { title: 'dup', author: 'a' },
    ]
    expect(countDuplicates(posts)).toBe(2)
  })
})
