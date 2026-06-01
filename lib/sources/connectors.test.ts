import { describe, it, expect } from 'vitest'
import { parseHnHits } from './hackernews'
import { parseSoItems } from './stackoverflow'

describe('parseHnHits', () => {
  it('maps Algolia hits to RawSignals with engagement', () => {
    const json = {
      hits: [
        {
          objectID: '123',
          title: 'Show HN: my tool',
          url: 'https://example.com',
          author: 'pg',
          points: 42,
          num_comments: 7,
          created_at_i: 1_700_000_000,
          story_text: 'body here',
        },
      ],
    }
    const [s] = parseHnHits(json)
    expect(s.source).toBe('hackernews')
    expect(s.externalId).toBe('123')
    expect(s.title).toBe('Show HN: my tool')
    expect(s.url).toBe('https://example.com')
    expect(s.engagement).toEqual({ score: 42, comments: 7 })
    expect(s.createdAt).toBe(1_700_000_000 * 1000)
  })
  it('falls back to the HN item url when no story url', () => {
    const [s] = parseHnHits({ hits: [{ objectID: '9', title: 't' }] })
    expect(s.url).toBe('https://news.ycombinator.com/item?id=9')
    expect(s.createdAt).toBeNull()
  })
  it('skips hits missing id or title, tolerates junk', () => {
    expect(parseHnHits({ hits: [{ objectID: '1' }, { title: 'x' }] })).toEqual([])
    expect(parseHnHits(null)).toEqual([])
    expect(parseHnHits({})).toEqual([])
  })
})

describe('parseSoItems', () => {
  it('maps Stack Exchange items, decodes title, strips body HTML', () => {
    const json = {
      items: [
        {
          question_id: 555,
          title: 'How to fix &quot;CORS&quot; error?',
          body: '<p>I keep getting <b>blocked</b></p>',
          link: 'https://stackoverflow.com/q/555',
          score: 3,
          answer_count: 0,
          creation_date: 1_700_000_000,
          owner: { display_name: 'dev' },
        },
      ],
    }
    const [s] = parseSoItems(json)
    expect(s.source).toBe('stackoverflow')
    expect(s.externalId).toBe('555')
    expect(s.title).toBe('How to fix "CORS" error?')
    expect(s.body).toBe('I keep getting blocked')
    expect(s.author).toBe('dev')
    expect(s.engagement).toEqual({ score: 3, comments: 0 })
    expect(s.createdAt).toBe(1_700_000_000 * 1000)
  })
  it('skips items missing id/title and tolerates junk', () => {
    expect(parseSoItems({ items: [{ title: 'x' }, { question_id: 1 }] })).toEqual([])
    expect(parseSoItems(undefined)).toEqual([])
  })
})
