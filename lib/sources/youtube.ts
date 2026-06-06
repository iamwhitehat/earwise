// YouTube connector — Data API v3 (search.list → commentThreads.list). Needs a
// free YOUTUBE_API_KEY (Google Cloud Console → enable "YouTube Data API v3" →
// create an API key). Comment-centric: a video's comments are where viewers
// voice need/pain, which is the demand signal — the video itself is the context.
//
// NOTE (PII/ToS): YouTube's terms restrict harvesting person-identifying data.
// We keep only the public authorDisplayName for attribution and never persist
// more than the engine needs. Quota: search.list costs 100 units/query.
import type { RawSignal, SourceConnector } from './types'

const SEARCH = 'https://www.googleapis.com/youtube/v3/search'
const COMMENTS = 'https://www.googleapis.com/youtube/v3/commentThreads'
const MAX_VIDEOS = 5
const MAX_COMMENTS = 20

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}
function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/** Pure: map a search.list response to {videoId, title}. Exported for tests. */
export function parseSearchVideos(json: unknown): { videoId: string; title: string }[] {
  const items = obj(json)?.items
  if (!Array.isArray(items)) return []
  const out: { videoId: string; title: string }[] = []
  for (const it of items) {
    const o = obj(it)
    const id = obj(o?.id)?.videoId
    if (typeof id === 'string' && id) out.push({ videoId: id, title: str(obj(o?.snippet)?.title) })
  }
  return out
}

/** Pure: map a commentThreads.list response to RawSignals. Exported for tests. */
export function parseCommentThreads(json: unknown, videoId: string, videoTitle: string): RawSignal[] {
  const items = obj(json)?.items
  if (!Array.isArray(items)) return []
  const out: RawSignal[] = []
  for (const it of items) {
    const threadSnippet = obj(obj(it)?.snippet)
    const top = obj(threadSnippet?.topLevelComment)
    const sn = obj(top?.snippet)
    const cid = top?.id
    if (!sn || typeof cid !== 'string') continue
    const body = str(sn.textOriginal)
    if (!body) continue
    const published = Date.parse(str(sn.publishedAt))
    out.push({
      source: 'youtube',
      externalId: `${videoId}:${cid}`,
      title: videoTitle,
      body,
      author: str(sn.authorDisplayName),
      url: `https://www.youtube.com/watch?v=${videoId}&lc=${cid}`,
      createdAt: Number.isFinite(published) ? published : null,
      engagement: { score: num(sn.likeCount), comments: num(threadSnippet?.totalReplyCount) },
    })
  }
  return out
}

export const youtubeConnector: SourceConnector = {
  id: 'youtube',
  async search(query, signal) {
    const key = process.env.YOUTUBE_API_KEY
    const q = query.trim()
    if (!key || !q) return [] // no key → gracefully empty (gate reports DRY)
    try {
      const sp = new URLSearchParams({ part: 'snippet', type: 'video', q, maxResults: String(MAX_VIDEOS), relevanceLanguage: 'en', key })
      const sres = await fetch(`${SEARCH}?${sp.toString()}`, { signal })
      if (!sres.ok) return []
      const videos = parseSearchVideos(await sres.json())
      const out: RawSignal[] = []
      for (const v of videos) {
        const cp = new URLSearchParams({ part: 'snippet', videoId: v.videoId, maxResults: String(MAX_COMMENTS), order: 'relevance', textFormat: 'plainText', key })
        const cres = await fetch(`${COMMENTS}?${cp.toString()}`, { signal })
        if (!cres.ok) continue
        out.push(...parseCommentThreads(await cres.json(), v.videoId, v.title))
      }
      return out
    } catch (err) {
      console.warn('[sources/youtube] fetch failed:', err)
      return []
    }
  },
}
