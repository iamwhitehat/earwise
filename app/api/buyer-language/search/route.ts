import type { NextRequest } from 'next/server'
import { getSupabase } from '@/lib/supabase'

const MAX_RESULTS = 20
const MAX_TERM_LEN = 80

// GET /api/buyer-language/search?term=tired+of+manually&kind=phrase|tool|emotional
// Returns up to 20 matches across posts + comments. For "tool", searches the
// posts.tools[] array (exact membership). For phrase/emotional, runs ILIKE
// against post titles, post bodies, and comment bodies.

type MatchRow = {
  kind: 'post' | 'comment'
  post_id: string
  subreddit: string
  permalink: string
  snippet: string
  title?: string | null
  author?: string | null
}

function makeSnippet(text: string, term: string, ctxChars = 80): string {
  const lower = text.toLowerCase()
  const i = lower.indexOf(term.toLowerCase())
  if (i < 0) return text.slice(0, 160)
  const start = Math.max(0, i - ctxChars)
  const end = Math.min(text.length, i + term.length + ctxChars)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < text.length ? '…' : ''
  return prefix + text.slice(start, end).replace(/\s+/g, ' ').trim() + suffix
}

function escapeIlike(s: string): string {
  // Supabase uses PostgREST .ilike with %; escape % and _ in user input so
  // they're treated literally.
  return s.replace(/[%_\\]/g, (m) => `\\${m}`)
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const rawTerm = url.searchParams.get('term') ?? ''
  const kind = (url.searchParams.get('kind') ?? 'phrase').toLowerCase() as
    | 'phrase'
    | 'tool'
    | 'emotional'

  const term = rawTerm.trim()
  if (!term) {
    return Response.json({ error: 'Missing term parameter' }, { status: 400 })
  }
  if (term.length > MAX_TERM_LEN) {
    return Response.json(
      { error: `Term too long (max ${MAX_TERM_LEN} chars)` },
      { status: 400 }
    )
  }

  let db
  try {
    db = getSupabase()
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Configuration error' },
      { status: 500 }
    )
  }

  const matches: MatchRow[] = []

  if (kind === 'tool') {
    // posts.tools is text[]; use cs (contains) with a JSON-encoded array.
    const { data, error } = await db
      .from('posts')
      .select('post_id, subreddit, title, selftext, author')
      .contains('tools', [term.toLowerCase()])
      .order('analyzed_at', { ascending: false })
      .limit(MAX_RESULTS)
    if (error) {
      console.error('[buyer-language/search] tools error:', error)
      return Response.json(
        { error: `Database query failed: ${error.message}` },
        { status: 500 }
      )
    }
    for (const row of data ?? []) {
      const id = row.post_id as string
      const subreddit = row.subreddit as string
      const title = row.title as string
      const selftext = (row.selftext as string | null) ?? ''
      matches.push({
        kind: 'post',
        post_id: id,
        subreddit,
        permalink: `https://www.reddit.com/r/${subreddit}/comments/${id}/`,
        snippet: title,
        title,
        author: row.author as string | null,
      })
      if (matches.length >= MAX_RESULTS) break
      if (selftext) {
        const snippet = makeSnippet(selftext, term)
        if (snippet) {
          matches.push({
            kind: 'post',
            post_id: id,
            subreddit,
            permalink: `https://www.reddit.com/r/${subreddit}/comments/${id}/`,
            snippet,
            title,
          })
        }
      }
    }
    return Response.json({ matches: matches.slice(0, MAX_RESULTS) })
  }

  // phrase or emotional: ILIKE on post titles/bodies AND comment bodies.
  const pattern = `%${escapeIlike(term)}%`

  const [postsRes, commentsRes] = await Promise.all([
    db
      .from('posts')
      .select('post_id, subreddit, title, selftext, author')
      .or(`title.ilike.${pattern},selftext.ilike.${pattern}`)
      .order('analyzed_at', { ascending: false })
      .limit(MAX_RESULTS),
    db
      .from('post_comments')
      .select('post_id, subreddit, body, author')
      .ilike('body', pattern)
      .order('analyzed_at', { ascending: false })
      .limit(MAX_RESULTS),
  ])

  if (postsRes.error || commentsRes.error) {
    const err = postsRes.error ?? commentsRes.error
    console.error('[buyer-language/search] error:', err)
    return Response.json(
      { error: `Database query failed: ${err?.message}` },
      { status: 500 }
    )
  }

  for (const row of postsRes.data ?? []) {
    const id = row.post_id as string
    const subreddit = row.subreddit as string
    const title = row.title as string
    const selftext = (row.selftext as string | null) ?? ''
    const haystack = `${title}\n${selftext}`
    matches.push({
      kind: 'post',
      post_id: id,
      subreddit,
      permalink: `https://www.reddit.com/r/${subreddit}/comments/${id}/`,
      snippet: makeSnippet(haystack, term),
      title,
      author: row.author as string | null,
    })
    if (matches.length >= MAX_RESULTS) break
  }

  for (const row of commentsRes.data ?? []) {
    if (matches.length >= MAX_RESULTS) break
    const id = row.post_id as string
    const subreddit = row.subreddit as string
    const body = (row.body as string | null) ?? ''
    matches.push({
      kind: 'comment',
      post_id: id,
      subreddit,
      // Reddit doesn't expose individual comment permalinks via our data, so
      // we link to the parent post — the comment will be visible there.
      permalink: `https://www.reddit.com/r/${subreddit}/comments/${id}/`,
      snippet: makeSnippet(body, term),
      author: row.author as string | null,
    })
  }

  return Response.json({ matches: matches.slice(0, MAX_RESULTS) })
}
