import type { NextRequest } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import type { Category } from '@/lib/categories'
import { canonicalTopic } from '@/lib/topics'

const MAX_RESULTS = 500
const VOCAB_CAP = 5000

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const topicParam = url.searchParams.get('topic')?.trim()
  if (!topicParam) {
    return Response.json({ error: 'Missing topic parameter' }, { status: 400 })
  }
  // The selected topic is a canonical label (trends are canonical); match all
  // raw topics that reduce to it. Canonicalize the param too in case a raw
  // label is passed.
  const target = canonicalTopic(topicParam)
  if (!target) return Response.json([])

  let db
  try {
    db = getSupabase()
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Configuration error' },
      { status: 500 }
    )
  }

  // Resolve which stored raw topics map to the requested canonical, then fetch
  // only those rows. Column-independent (computes canonical from `topic`).
  const vocabRes = await db
    .from('posts')
    .select('topic')
    .not('topic', 'is', null)
    .limit(VOCAB_CAP)
  if (vocabRes.error) {
    console.error('[supabase] posts-by-topic vocab error:', vocabRes.error)
    return Response.json({ error: `Database query failed: ${vocabRes.error.message}.` }, { status: 500 })
  }
  const matching = Array.from(
    new Set(
      (vocabRes.data ?? [])
        .map((r) => r.topic as string)
        .filter((t) => canonicalTopic(t) === target),
    ),
  )
  if (matching.length === 0) return Response.json([])

  const { data, error } = await db
    .from('posts')
    .select(
      'post_id, subreddit, title, selftext, author, category, topic, analyzed_at, tools, quotes, comments_scanned_at, num_comments, confidence',
    )
    .in('topic', matching)
    .order('analyzed_at', { ascending: false })
    .limit(MAX_RESULTS)

  if (error) {
    console.error('[supabase] posts-by-topic error:', error)
    return Response.json(
      {
        error: `Database query failed: ${error.message}. ` +
          `If the message names a missing column or table, run the relevant migration in SETUP.md.`,
      },
      { status: 500 }
    )
  }

  // Construct permalinks deterministically from (subreddit, post_id) — same
  // pattern as /api/posts/[subreddit]. The stored permalink column may
  // contain stale/malformed values from earlier versions of the parser.
  const posts = (data ?? []).map((r) => {
    const id = r.post_id as string
    const subreddit = r.subreddit as string
    const selftext = (r.selftext as string | null) ?? ''
    const commentsAt = r.comments_scanned_at as string | null
    return {
      id,
      subreddit,
      title: r.title as string,
      selftext,
      author: r.author as string,
      permalink: `https://www.reddit.com/r/${subreddit}/comments/${id}/`,
      is_self: selftext.length > 0,
      category: r.category as Category,
      topic: r.topic as string,
      analyzedAt: r.analyzed_at ? new Date(r.analyzed_at as string).getTime() : Date.now(),
      tools: (r.tools as string[] | null) ?? null,
      quotes: r.quotes ?? null,
      commentsScannedAt: commentsAt ? new Date(commentsAt).getTime() : null,
      // DB column stays `num_comments`; the value is the sampled count.
      commentsSampled: (r.num_comments as number | null) ?? null,
      confidence: (r.confidence as string | null) ?? null,
    }
  })

  return Response.json(posts)
}
