import { describe, it, expect } from 'vitest'
import { parseSearchVideos, parseCommentThreads } from './youtube'

describe('parseSearchVideos', () => {
  it('extracts video id + title, skips items without a videoId', () => {
    const json = {
      items: [
        { id: { videoId: 'abc' }, snippet: { title: 'Cheap CRM alternatives' } },
        { id: { kind: 'channel' }, snippet: { title: 'no videoId' } },
      ],
    }
    expect(parseSearchVideos(json)).toEqual([{ videoId: 'abc', title: 'Cheap CRM alternatives' }])
  })
  it('returns [] for malformed input', () => {
    expect(parseSearchVideos(null)).toEqual([])
    expect(parseSearchVideos({})).toEqual([])
  })
})

describe('parseCommentThreads', () => {
  it('maps top-level comments to RawSignals with engagement', () => {
    const json = {
      items: [
        {
          snippet: {
            totalReplyCount: 3,
            topLevelComment: {
              id: 'c1',
              snippet: {
                textOriginal: 'Is there a free alternative to this?',
                authorDisplayName: 'jane',
                likeCount: 12,
                publishedAt: '2024-01-02T00:00:00Z',
              },
            },
          },
        },
        { snippet: { topLevelComment: { id: 'c2', snippet: { textOriginal: '' } } } }, // empty body → skip
      ],
    }
    const out = parseCommentThreads(json, 'vid9', 'Best tools 2024')
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      source: 'youtube',
      externalId: 'vid9:c1',
      title: 'Best tools 2024',
      body: 'Is there a free alternative to this?',
      author: 'jane',
      url: 'https://www.youtube.com/watch?v=vid9&lc=c1',
      engagement: { score: 12, comments: 3 },
    })
    expect(out[0].createdAt).toBe(Date.parse('2024-01-02T00:00:00Z'))
  })
  it('returns [] for malformed input', () => {
    expect(parseCommentThreads({}, 'v', 't')).toEqual([])
  })
})
