// Reddit connector — wraps the anonymous .rss fetch + Atom parser. The query is a
// subreddit name. RSS doesn't expose score/comments, so engagement is left empty.
//
// Politeness (reduce the chance Reddit throttles/blocks us — our biggest platform
// risk): a descriptive User-Agent, one backoff retry on 429/503, and a short
// in-process cache so repeated fetches of the same sub within CACHE_TTL_MS don't
// re-hit Reddit (helps the public funnel + cron + /try; the interactive scan uses
// its own fetchRedditPages path).
import { parseAtom } from '../reddit-parse'
import type { RawSignal, SourceConnector } from './types'

const REDDIT_HEADERS = {
  'User-Agent': 'web:earwise-app:v1.0 (by /u/anonymous)',
  Accept: 'application/atom+xml,application/xml',
}

const SUB_RE = /^[a-z0-9_]{2,21}$/i
const PAGE_LIMIT = 100
const CACHE_TTL_MS = 5 * 60 * 1000
const RETRY_DELAY_MS = 1500

// Demand-phrase search query — a focused subset of the buying-intent phrases.
// Reddit's `new` feed only shows the last ~100 posts (mostly noise); a phrase
// search pulls a YEAR of posts that explicitly voice need, far denser and
// reaching older history the `new` feed scrolled past. Free (RSS), so this only
// costs an extra network call, not Claude budget.
const DEMAND_PHRASES = [
  'looking for', 'alternative to', 'is there a tool', 'any recommendations',
  'what do you use for', 'recommend a', 'anyone know a', 'best tool for',
]
const SEARCH_Q = encodeURIComponent(DEMAND_PHRASES.map((p) => `"${p}"`).join(' OR '))

const cache = new Map<string, { at: number; signals: RawSignal[] }>()
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** One backoff retry on transient throttling (429/503); null on hard failure. */
async function fetchPolite(url: string, signal?: AbortSignal): Promise<Response | null> {
  for (let attempt = 0; attempt <= 1; attempt++) {
    const res = await fetch(url, { headers: REDDIT_HEADERS, signal })
    if (res.ok) return res
    if ((res.status === 429 || res.status === 503) && attempt === 0) {
      await sleep(RETRY_DELAY_MS)
      continue
    }
    console.warn(`[sources/reddit] ${url} → ${res.status}`)
    return null
  }
  return null
}

/** Fetch one Reddit Atom feed (new or search) → RawSignals. [] on any failure. */
async function fetchFeed(url: string, sub: string, signal?: AbortSignal): Promise<RawSignal[]> {
  const res = await fetchPolite(url, signal)
  if (!res) return []
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
}

export const redditConnector: SourceConnector = {
  id: 'reddit',
  async search(query, signal) {
    const sub = query.trim().replace(/^\/?r\//i, '')
    if (!SUB_RE.test(sub)) return []

    const cached = cache.get(sub)
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.signals

    try {
      const base = `https://www.reddit.com/r/${encodeURIComponent(sub)}`
      // Phrase search (a year of demand) FIRST, then the latest `new` feed.
      // Search-first ordering prioritizes the denser rows within the downstream
      // classify budget; both are free RSS so this adds no Claude cost.
      const [searchSigs, newSigs] = await Promise.all([
        fetchFeed(`${base}/search.rss?q=${SEARCH_Q}&restrict_sr=1&sort=new&t=year&limit=${PAGE_LIMIT}`, sub, signal),
        fetchFeed(`${base}/new.rss?limit=${PAGE_LIMIT}`, sub, signal),
      ])

      const seen = new Set<string>()
      const merged: RawSignal[] = []
      for (const s of [...searchSigs, ...newSigs]) {
        if (seen.has(s.externalId)) continue
        seen.add(s.externalId)
        merged.push(s)
      }
      if (merged.length === 0) return cached?.signals ?? [] // serve stale rather than nothing
      cache.set(sub, { at: Date.now(), signals: merged })
      return merged
    } catch (err) {
      console.warn('[sources/reddit] fetch failed:', err)
      return cached?.signals ?? []
    }
  },
}
