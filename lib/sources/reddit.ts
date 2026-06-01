// Reddit connector — wraps the existing anonymous .rss fetch + Atom parser.
// The query is a subreddit name. RSS doesn't expose score/comments, so
// engagement is left empty (the OAuth pipeline would fill it later).
import { parseAtom } from '../reddit-parse'
import type { RawSignal, SourceConnector } from './types'

const REDDIT_HEADERS = {
  'User-Agent': 'web:reddit-reader-app:v1.0 (by /u/anonymous)',
  Accept: 'application/atom+xml,application/xml',
}

const SUB_RE = /^[a-z0-9_]{2,21}$/i
const PAGE_LIMIT = 100

export const redditConnector: SourceConnector = {
  id: 'reddit',
  async search(query, signal) {
    const sub = query.trim().replace(/^\/?r\//i, '')
    if (!SUB_RE.test(sub)) return []
    try {
      const res = await fetch(
        `https://www.reddit.com/r/${encodeURIComponent(sub)}/new.rss?limit=${PAGE_LIMIT}`,
        { headers: REDDIT_HEADERS, signal },
      )
      if (!res.ok) return []
      const xml = await res.text()
      if (!xml.includes('<entry>')) return []
      const { posts } = parseAtom(xml, sub)
      return posts.map(
        (p): RawSignal => ({
          source: 'reddit',
          externalId: p.id,
          title: p.title,
          body: p.selftext,
          author: p.author,
          url: p.permalink,
          createdAt: p.postedAt,
          engagement: {},
        }),
      )
    } catch (err) {
      console.warn('[sources/reddit] fetch failed:', err)
      return []
    }
  },
}
