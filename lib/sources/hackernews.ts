// Hacker News connector — Algolia HN Search API (free, no key).
// https://hn.algolia.com/api  →  GET /api/v1/search?query=…&tags=story
import type { RawSignal, SourceConnector } from './types'

const HN_ENDPOINT = 'https://hn.algolia.com/api/v1/search'
const HITS = 50

type HnHit = {
  objectID?: unknown
  title?: unknown
  url?: unknown
  author?: unknown
  points?: unknown
  num_comments?: unknown
  created_at_i?: unknown
  story_text?: unknown
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/** Pure: map an Algolia HN response into RawSignals. Exported for tests. */
export function parseHnHits(json: unknown): RawSignal[] {
  const hits = (json as { hits?: unknown })?.hits
  if (!Array.isArray(hits)) return []
  const out: RawSignal[] = []
  for (const raw of hits as HnHit[]) {
    const objectID = typeof raw.objectID === 'string' ? raw.objectID : ''
    const title = typeof raw.title === 'string' ? raw.title.trim() : ''
    if (!objectID || !title) continue
    const created = num(raw.created_at_i)
    out.push({
      source: 'hackernews',
      externalId: objectID,
      title,
      body: typeof raw.story_text === 'string' ? raw.story_text : '',
      author: typeof raw.author === 'string' ? raw.author : '',
      url:
        typeof raw.url === 'string' && raw.url
          ? raw.url
          : `https://news.ycombinator.com/item?id=${objectID}`,
      createdAt: created != null ? created * 1000 : null,
      engagement: { score: num(raw.points), comments: num(raw.num_comments) },
    })
  }
  return out
}

export const hackernewsConnector: SourceConnector = {
  id: 'hackernews',
  async search(query, signal) {
    const q = query.trim()
    if (!q) return []
    try {
      const params = new URLSearchParams({ query: q, tags: 'story', hitsPerPage: String(HITS) })
      const res = await fetch(`${HN_ENDPOINT}?${params.toString()}`, { signal })
      if (!res.ok) return []
      return parseHnHits(await res.json())
    } catch (err) {
      console.warn('[sources/hackernews] fetch failed:', err)
      return []
    }
  },
}
