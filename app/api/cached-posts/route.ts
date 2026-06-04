import type { NextRequest } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import type { Category } from '@/lib/categories'

// Cap matches PER_SUB_CAP on the client (500 per sub × 5 subs max).
const MAX_PER_SUB = 500
const MAX_TOTAL_ROWS = 5000

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const subsParam = url.searchParams.get('subs') ?? ''
  const subs = Array.from(
    new Set(
      subsParam
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter((s) => /^[a-z0-9_]{2,21}$/.test(s)),
    ),
  )

  if (subs.length === 0) {
    return Response.json({})
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

  // One round trip for all subs. We could enforce per-sub caps in SQL via
  // window functions, but the dataset is small and a JS-side cap is plenty.
  const { data, error } = await db
    .from('posts')
    .select(
      'post_id, subreddit, title, selftext, author, category, topic, analyzed_at, tools, quotes, comments_scanned_at, num_comments, confidence',
    )
    .in('subreddit', subs)
    .order('analyzed_at', { ascending: false })
    .limit(MAX_TOTAL_ROWS)

  if (error) {
    console.error('[supabase] cached-posts error:', error)
    return Response.json(
      {
        error: `Database query failed: ${error.message}. ` +
          `If the message mentions a missing column or table, run the relevant migration in SETUP.md (section 2b-quater for tools/quotes/comments_scanned_at/num_comments, 2b-quinquies for confidence, 2b-sexies for trend_insights, 2b-septies for trend_snapshots).`,
      },
      { status: 500 }
    )
  }

  const buckets: Record<string, unknown[]> = {}
  for (const sub of subs) buckets[sub] = []

  for (const row of data ?? []) {
    const sub = row.subreddit as string
    const bucket = buckets[sub]
    if (!bucket || bucket.length >= MAX_PER_SUB) continue
    const id = row.post_id as string
    const selftext = (row.selftext as string | null) ?? ''
    const commentsAt = row.comments_scanned_at as string | null
    bucket.push({
      id,
      subreddit: sub,
      title: row.title as string,
      selftext,
      author: row.author as string,
      permalink: `https://www.reddit.com/r/${sub}/comments/${id}/`,
      is_self: selftext.length > 0,
      category: row.category as Category,
      topic: (row.topic as string | null) ?? null,
      analyzedAt: new Date(row.analyzed_at as string).getTime(),
      tools: (row.tools as string[] | null) ?? null,
      quotes: (row.quotes as unknown) ?? null,
      commentsScannedAt: commentsAt ? new Date(commentsAt).getTime() : null,
      // DB column stays `num_comments`; the value is the sampled count.
      commentsSampled: (row.num_comments as number | null) ?? null,
      confidence: (row.confidence as string | null) ?? null,
    })
  }

  return Response.json(buckets)
}
