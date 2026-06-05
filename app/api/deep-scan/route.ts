import type { NextRequest } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { activeProjectId } from '@/lib/project-server'
import { gateUsage } from '@/lib/usage-credits-db'
import { extractCommentInsights, PRIORITY, type CommentQuote } from '@/lib/claude'
import { COMMENT_SAMPLE_CAP } from '@/lib/scan-types'
import { parseCommentEntries } from '@/lib/reddit-parse'

const REDDIT_HEADERS = {
  'User-Agent': 'web:earwise-app:v1.0 (by /u/anonymous)',
  Accept: 'application/atom+xml,application/xml',
}

// Reddit's .json endpoint started returning 403 to unauthenticated requests
// in 2023; the .rss feed still works. The trade-off: RSS doesn't expose
// upvote counts, so we trust `sort=top` to put highest-voted first and store
// upvotes as 0 in our cache. Good enough for cost-controlled extraction.

// XML parsing lives in lib/reddit-parse.ts (shared with the posts route).

function isValidSub(s: string): boolean {
  return /^[a-z0-9_]{2,21}$/i.test(s)
}

function isValidPostId(s: string): boolean {
  // Reddit post IDs are short base36 strings (5–9 chars in practice).
  return /^[a-z0-9]{4,12}$/i.test(s)
}

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const { subreddit, postId, foreground } = (body ?? {}) as {
    subreddit?: unknown
    postId?: unknown
    foreground?: unknown
  }
  if (typeof subreddit !== 'string' || !isValidSub(subreddit)) {
    return Response.json({ error: 'Invalid subreddit' }, { status: 400 })
  }
  if (typeof postId !== 'string' || !isValidPostId(postId)) {
    return Response.json({ error: 'Invalid postId' }, { status: 400 })
  }
  // A single "Deep scan" click is foreground (user waiting on one post); the
  // bulk deep-scan loop omits the flag and stays BULK so it yields to clicks.
  const priority = foreground === true ? PRIORITY.FOREGROUND : PRIORITY.BULK

  let db
  try {
    db = getSupabase()
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Configuration error' },
      { status: 500 }
    )
  }

  // Usage-credit gate (margin guard) — deep-scan is the per-post cost driver.
  const over = await gateUsage(db, await activeProjectId(), 'deepScanPost')
  if (over) return over

  // 1. Look up the post; refuse if missing or category === 'other' (cost guard).
  const { data: postRow, error: postErr } = await db
    .from('posts')
    .select('post_id, subreddit, title, category')
    .eq('post_id', postId)
    .eq('subreddit', subreddit)
    .maybeSingle()

  if (postErr) {
    console.error('[deep-scan] post lookup error:', postErr)
    return Response.json({ error: 'Database query failed' }, { status: 500 })
  }
  if (!postRow) {
    return Response.json(
      { error: 'Post not found in cache — run a regular scan first' },
      { status: 404 }
    )
  }
  if (postRow.category === 'other') {
    return Response.json(
      { error: "Deep scan is disabled for posts classified as 'other'" },
      { status: 400 }
    )
  }

  // 2. Fetch top-level comments via Reddit's Atom RSS feed (the .json endpoint
  //    returns 403 to unauthenticated callers). sort=top returns the comment
  //    listing in upvote-desc order, which we preserve as-is.
  const url = `https://www.reddit.com/comments/${encodeURIComponent(postId)}.rss?sort=top&limit=${COMMENT_SAMPLE_CAP}`
  const res = await fetch(url, { headers: REDDIT_HEADERS })
  if (!res.ok) {
    return Response.json(
      { error: `Reddit returned ${res.status} fetching comments` },
      { status: res.status }
    )
  }
  const xml = await res.text()
  const comments = parseCommentEntries(xml, postId)

  // 3. Upsert raw comments (idempotent — dedup by comment_id).
  if (comments.length > 0) {
    const { error: insertErr } = await db.from('post_comments').upsert(
      comments.map((c) => ({
        comment_id: c.id,
        post_id: postId,
        subreddit,
        body: c.body,
        author: c.author,
        upvotes: c.ups,
      })),
      { onConflict: 'comment_id', ignoreDuplicates: true },
    )
    if (insertErr) console.error('[supabase] post_comments insert error:', insertErr)
  }

  // 4. Extract insights via one Claude call (or skip if no comments).
  //    Same call also returns per-comment classifications (pain/feature/tool/other).
  const insights =
    comments.length > 0
      ? // FOREGROUND for a single user-waited click; BULK for the bulk loop, so
        // it yields to clicks like "Load more" and single deep-scans.
        await extractCommentInsights(
          postRow.title as string,
          comments.map((c) => ({ body: c.body })),
          priority,
        )
      : { tools: [] as string[], quotes: [] as CommentQuote[], classifications: [] as Array<{ index: number; category: string }> }

  // 4b. Persist per-comment categories. Indices in the Claude response are
  //     1-based and align with the order of `comments` above.
  if (comments.length > 0 && insights.classifications.length > 0) {
    const updates = insights.classifications
      .map((c) => {
        const target = comments[c.index - 1]
        if (!target) return null
        return { comment_id: target.id, category: c.category }
      })
      .filter((x): x is { comment_id: string; category: string } => x !== null)
    // One UPDATE per comment (small number, <=20). Cheaper than a CASE/UPDATE
    // construction and Supabase doesn't ship a batch-update helper. Failures
    // are logged but don't block the insight write below.
    for (const u of updates) {
      const { error: catErr } = await db
        .from('post_comments')
        .update({ category: u.category })
        .eq('comment_id', u.comment_id)
      if (catErr) console.error('[supabase] comment category update error:', catErr)
    }
  }

  // 5. Persist insights + sampled-comment count on the post row. The DB
  //    column is named `num_comments` for legacy reasons, but it stores the
  //    SAMPLE size — what we actually got from RSS (top-level, undeleted,
  //    capped at COMMENT_SAMPLE_CAP). Reddit's anonymous .json endpoint
  //    that exposes the true total returns 403, so this is what we can
  //    capture without OAuth. The API response uses the honest name
  //    `commentsSampled`.
  const now = new Date().toISOString()
  const { error: updateErr } = await db
    .from('posts')
    .update({
      tools: insights.tools,
      quotes: insights.quotes,
      comments_scanned_at: now,
      num_comments: comments.length,
    })
    .eq('post_id', postId)
    .eq('subreddit', subreddit)
  if (updateErr) {
    console.error('[supabase] posts insight update error:', updateErr)
    return Response.json(
      { error: 'Database update failed — confirm Deep Scan migration has run. See SETUP.md (2b-quater).' },
      { status: 500 }
    )
  }

  return Response.json({
    tools: insights.tools,
    quotes: insights.quotes,
    commentsScannedAt: Date.parse(now),
    commentsSampled: comments.length,
    commentsSampleCap: COMMENT_SAMPLE_CAP,
  })
}
