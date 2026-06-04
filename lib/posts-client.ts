import type { Category } from './categories'

export type CommentQuote = {
  text: string
  type: 'wish' | 'switched' | 'would_pay' | 'hate'
}

export interface ApiPost {
  id: string
  title: string
  selftext: string
  author: string
  is_self: boolean
  permalink: string
  category: Category
  topic: string | null
  analyzedAt: number // epoch ms
  tools: string[] | null
  quotes: CommentQuote[] | null
  commentsScannedAt: number | null
  /**
   * Number of top-level comments sampled during deep scan. Capped at
   * COMMENT_SAMPLE_CAP — this is NOT the post's true comment total. UI must
   * label it accordingly.
   */
  commentsSampled: number | null
  confidence: 'high' | 'medium' | 'low' | null
}

// Cached posts also carry their subreddit (the /api/cached-posts endpoint
// returns a map keyed by sub, so each row needs to identify which one it
// came from when flattened on the client).
export type CachedPost = ApiPost & { subreddit: string }

export async function fetchCachedPosts(
  subs: string[],
): Promise<Record<string, CachedPost[]>> {
  if (subs.length === 0) return {}
  const params = new URLSearchParams({ subs: subs.join(',') })
  const res = await fetch(`/api/cached-posts?${params}`)
  if (!res.ok) {
    const errJson = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(errJson.error ?? `Cached-posts fetch failed: ${res.status}`)
  }
  return (await res.json()) as Record<string, CachedPost[]>
}

export type StreamEvent =
  | {
      type: 'status'
      newCount: number
      cachedCount: number
      backfillCount: number
    }
  | {
      type: 'progress'
      phase: 'classify' | 'backfill'
      current: number
      total: number
    }

export type FetchSubOptions = {
  after?: string
  count?: number
  limit?: number
  signal?: AbortSignal
  onEvent?: (event: StreamEvent) => void
  onPost?: (post: ApiPost, index: number) => void
}

export type FetchSubResult = {
  posts: ApiPost[]
  nextAfter: string | null
}

type PostEvent = { type: 'post'; index: number; post: ApiPost }
type DoneEvent = { type: 'done'; nextAfter: string | null }
type ErrorEvent = { type: 'error'; message: string }
type AnyEvent = StreamEvent | PostEvent | DoneEvent | ErrorEvent

const DEFAULT_PAGE_SIZE = 100

export async function fetchSubPosts(
  sub: string,
  opts: FetchSubOptions = {},
): Promise<FetchSubResult> {
  const params = new URLSearchParams({ limit: String(opts.limit ?? DEFAULT_PAGE_SIZE) })
  if (opts.after) params.set('after', opts.after)
  if (opts.count && opts.count > 0) params.set('count', String(opts.count))

  const res = await fetch(`/api/posts/${encodeURIComponent(sub)}?${params}`, {
    signal: opts.signal,
  })
  if (!res.ok) {
    const errJson = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(errJson.error ?? `Reddit error: ${res.status}`)
  }
  if (!res.body) throw new Error('No response body')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const finalRef: { value: DoneEvent | null } = { value: null }

  // Accumulate posts internally (by id, so backfill re-emissions replace) for
  // callers that just want the final list — e.g. the legacy /r/[subreddit]
  // view. Streaming callers should prefer onPost for live updates.
  const collected = new Map<string, { post: ApiPost; index: number }>()

  const processLine = (raw: string) => {
    const line = raw.trim()
    if (!line) return
    const event = JSON.parse(line) as AnyEvent
    if (event.type === 'done') {
      finalRef.value = event
    } else if (event.type === 'error') {
      throw new Error(event.message)
    } else if (event.type === 'post') {
      collected.set(event.post.id, { post: event.post, index: event.index })
      opts.onPost?.(event.post, event.index)
    } else {
      opts.onEvent?.(event)
    }
  }

  for (;;) {
    const { value, done: streamDone } = await reader.read()
    if (streamDone) break
    buffer += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buffer.indexOf('\n')) !== -1) {
      processLine(buffer.slice(0, nl))
      buffer = buffer.slice(nl + 1)
    }
  }
  buffer += decoder.decode()
  if (buffer.trim()) processLine(buffer)

  const done = finalRef.value
  if (!done) throw new Error('Stream ended without done event')

  const posts = Array.from(collected.values())
    .sort((a, b) => a.index - b.index)
    .map((e) => e.post)
  return { posts, nextAfter: done.nextAfter }
}
