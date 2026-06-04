import { getSupabase } from '@/lib/supabase'
import type { Category } from '@/lib/categories'

// GET /api/comment-stats — small rollup for the RadarBar's second line:
//   X posts deep-scanned · Y comments analyzed · per-category counts
// Three Supabase calls in parallel, each a count (no row payload).

export async function GET() {
  let db
  try {
    db = getSupabase()
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Configuration error' },
      { status: 500 }
    )
  }

  const [postsRes, commentsRes, byCatRes] = await Promise.all([
    db
      .from('posts')
      .select('post_id', { count: 'exact', head: true })
      .not('comments_scanned_at', 'is', null),
    db.from('post_comments').select('comment_id', { count: 'exact', head: true }),
    // Pull the category column (limit high) and bucket client-side. Supabase's
    // PostgREST doesn't support GROUP BY directly without an RPC, and the
    // payload is small enough (one short string per comment).
    db
      .from('post_comments')
      .select('category')
      .not('category', 'is', null)
      .limit(50_000),
  ])

  if (postsRes.error || commentsRes.error || byCatRes.error) {
    const err = postsRes.error ?? commentsRes.error ?? byCatRes.error
    console.error('[comment-stats] error:', err)
    return Response.json(
      {
        error: `Database query failed: ${err?.message}. ` +
          `If the message names a missing column or table, run section 2b-octies in SETUP.md.`,
      },
      { status: 500 }
    )
  }

  const byCategory: Record<Category, number> = {
    pain_point: 0,
    feature_request: 0,
    tool_complaint: 0,
    other: 0,
  }
  for (const row of byCatRes.data ?? []) {
    const cat = row.category as Category | null
    if (cat && cat in byCategory) byCategory[cat]++
  }

  return Response.json({
    postsScanned: postsRes.count ?? 0,
    commentsAnalyzed: commentsRes.count ?? 0,
    byCategory,
  })
}
