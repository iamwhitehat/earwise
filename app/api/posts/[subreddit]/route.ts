import type { NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabase } from '@/lib/supabase'
import { activeProjectId } from '@/lib/project-server'
import { gateUsage } from '@/lib/usage-credits-db'
import {
  classifyAndExtractBatch,
  extractTopicsBatch,
  CLASSIFY_BATCH_SIZE,
  PRIORITY,
  type Category,
  type ExampleSet,
  type ClassificationExample,
} from '@/lib/claude'
import { parseAtom, type ParsedPost } from '@/lib/reddit-parse'

const EXAMPLES_PER_CATEGORY = 3
const EXAMPLE_POOL_PER_CATEGORY = 20
const EXAMPLE_SNIPPET_CHARS = 100

// Fetch a few-shot example set for the current scan: 3 high-signal posts per
// category, preferring same-sub examples and (where applicable) posts with a
// topic already extracted (a weak proxy for prior-classifier confidence).
// Called ONCE per /api/posts/[subreddit] request and reused for every post.
async function fetchClassificationExamples(
  db: SupabaseClient,
  currentSub: string,
): Promise<ExampleSet> {
  const cats: Category[] = ['pain_point', 'feature_request', 'tool_complaint', 'other']
  const results = await Promise.all(
    cats.map((cat) =>
      db
        .from('posts')
        .select('subreddit, title, selftext, topic')
        .eq('category', cat)
        .order('analyzed_at', { ascending: false })
        .limit(EXAMPLE_POOL_PER_CATEGORY),
    ),
  )
  const out: ExampleSet = {
    pain_point: [],
    feature_request: [],
    tool_complaint: [],
    other: [],
  }
  results.forEach((res, i) => {
    const cat = cats[i]
    if (res.error || !res.data) return
    const rows = res.data as Array<{
      subreddit: string
      title: string
      selftext: string | null
      topic: string | null
    }>
    // Rank: same-sub first, then (for non-other) topic-present first, then recency
    // (already DESC from the query, so stable sort preserves it).
    const ranked = rows
      .map((r, idx) => ({
        r,
        idx,
        subMatch: r.subreddit === currentSub ? 0 : 1,
        topicRank: cat === 'other' ? 0 : r.topic ? 0 : 1,
      }))
      .sort((a, b) => a.subMatch - b.subMatch || a.topicRank - b.topicRank || a.idx - b.idx)
    const picked: ClassificationExample[] = []
    for (const { r } of ranked) {
      if (picked.length >= EXAMPLES_PER_CATEGORY) break
      const title = (r.title ?? '').trim()
      if (!title) continue
      const snippet = (r.selftext ?? '').trim().slice(0, EXAMPLE_SNIPPET_CHARS)
      picked.push({ title, snippet })
    }
    out[cat] = picked
  })
  return out
}

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 200            // accepted from the client
const REDDIT_PAGE_LIMIT = 100    // Reddit's per-request cap

function parseLimit(raw: string | null): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT
  return Math.min(MAX_LIMIT, Math.floor(n))
}

const REDDIT_HEADERS = {
  'User-Agent': 'web:reddit-reader-app:v1.0 (by /u/anonymous)',
  'Accept': 'application/atom+xml,application/xml',
}

// Fetch up to `limit` posts from Reddit, paginating internally because
// Reddit caps any single .rss request at 100 entries. Returns the combined
// posts plus the final cursor (for the client's Load More).
async function fetchRedditPages(
  subreddit: string,
  limit: number,
  initialAfter: string,
  initialCount: string | null,
  signal?: AbortSignal,
): Promise<
  | { ok: true; posts: ParsedPost[]; nextAfter: string | null }
  | { ok: false; status: number }
> {
  const all: ParsedPost[] = []
  let after = initialAfter
  let count = initialCount ? Number(initialCount) : 0
  let lastNextAfter: string | null = null

  while (all.length < limit) {
    if (signal?.aborted) break
    const want = Math.min(REDDIT_PAGE_LIMIT, limit - all.length)
    const params = new URLSearchParams({ limit: String(want) })
    if (after) params.set('after', after)
    if (count > 0) params.set('count', String(count))

    const res = await fetch(
      `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/new.rss?${params.toString()}`,
      { headers: REDDIT_HEADERS, signal },
    )
    if (!res.ok) {
      if (all.length === 0) return { ok: false, status: res.status }
      // Partial success — take what we have, keep the last cursor.
      break
    }
    const xml = await res.text()
    if (!xml.includes('<entry>')) break
    const { posts, nextAfter } = parseAtom(xml, subreddit)
    if (posts.length === 0) break
    all.push(...posts)
    lastNextAfter = nextAfter
    if (posts.length < want) break // Reddit ran out
    if (!nextAfter) break
    after = nextAfter
    count += posts.length
  }

  return { ok: true, posts: all, nextAfter: lastNextAfter }
}

type Resolved = {
  category: Category
  topic: string | null
  analyzedAt: number
  tools: string[] | null
  quotes: unknown
  commentsScannedAt: number | null
  commentsSampled: number | null
  confidence: string | null
}

// ─── Stream helpers ───────────────────────────────────────────────────────────
// Response body is newline-delimited JSON:
//   {"type":"progress","current":N,"total":M}\n
//   ...
//   {"type":"done","posts":[...],"nextAfter":"t3_xxx"|null}\n
// Or on mid-stream failure:
//   {"type":"error","message":"..."}\n
// Pre-flight failures (Reddit 404, Supabase config, etc.) still return classic
// JSON with a non-200 status so the client can distinguish them by res.ok.

const NDJSON_HEADERS = {
  'Content-Type': 'application/x-ndjson; charset=utf-8',
  'Cache-Control': 'no-store',
}

type StreamSink = {
  send: (event: object) => void
  close: () => void
}

function ndjsonStream(work: (sink: StreamSink) => Promise<void>): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      const sink: StreamSink = {
        send: (event) => {
          if (closed) return
          controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'))
        },
        close: () => {
          if (closed) return
          closed = true
          controller.close()
        },
      }
      try {
        await work(sink)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Internal error'
        console.error('[api/posts] stream error:', err)
        sink.send({ type: 'error', message })
      } finally {
        sink.close()
      }
    },
  })
  return new Response(stream, { headers: NDJSON_HEADERS })
}

export async function GET(req: NextRequest, ctx: RouteContext<'/api/posts/[subreddit]'>) {
  const { subreddit } = await ctx.params

  const url = new URL(req.url)
  const after = url.searchParams.get('after') ?? ''
  const countRaw = url.searchParams.get('count')
  const limit = parseLimit(url.searchParams.get('limit'))

  // A paginated request (`after` set) is a user clicking "Load more" — make its
  // Claude work FOREGROUND so it jumps ahead of any in-flight bulk scan/deep-scan
  // instead of queueing behind hundreds of throttled calls. The first page of a
  // scan is NORMAL.
  const priority = after ? PRIORITY.FOREGROUND : PRIORITY.NORMAL

  // ─── Pre-flight: Reddit fetch (may paginate internally if limit > 100) ─────
  const fetched = await fetchRedditPages(subreddit, limit, after, countRaw, req.signal)
  if (!fetched.ok) {
    const message =
      fetched.status === 404 ? `r/${subreddit} not found` :
      fetched.status === 403 ? `r/${subreddit} is private or banned` :
      `Reddit returned ${fetched.status}`
    return Response.json({ error: message }, { status: fetched.status })
  }

  const posts = fetched.posts
  const nextAfter = fetched.nextAfter
  if (posts.length === 0) {
    // End of feed during pagination is success-empty; missing entries on the
    // first page is a 404.
    if (after) return ndjsonStream(async (sink) => {
      sink.send({ type: 'done', nextAfter: null })
    })
    return Response.json({ error: `r/${subreddit} not found or has no posts` }, { status: 404 })
  }

  // ─── Pre-flight: Supabase ───────────────────────────────────────────────────
  let db
  try {
    db = getSupabase()
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Configuration error' },
      { status: 500 }
    )
  }

  const ids = posts.map((p) => p.id)
  const { data: cached, error: selectError } = await db
    .from('posts')
    .select('post_id, category, topic, analyzed_at, posted_at, tools, quotes, comments_scanned_at, num_comments, confidence')
    .eq('subreddit', subreddit)
    .in('post_id', ids)

  if (selectError) {
    console.error('[supabase] select error:', selectError)
    return Response.json(
      {
        error: `Database query failed: ${selectError.message}. ` +
          `If the message names a missing column or table, run the relevant migration in SETUP.md.`,
      },
      { status: 500 }
    )
  }

  const cachedById = new Map<string, Resolved>(
    (cached ?? []).map((r) => {
      const commentsAt = r.comments_scanned_at as string | null
      return [
        r.post_id as string,
        {
          category: r.category as Category,
          topic: (r.topic as string | null) ?? null,
          analyzedAt: new Date(r.analyzed_at as string).getTime(),
          tools: (r.tools as string[] | null) ?? null,
          quotes: r.quotes ?? null,
          commentsScannedAt: commentsAt ? new Date(commentsAt).getTime() : null,
          // DB column stays `num_comments` (no migration); the value is the
          // sampled count (≤ COMMENT_SAMPLE_CAP). See deep-scan/route.ts.
          commentsSampled: (r.num_comments as number | null) ?? null,
          confidence: (r.confidence as string | null) ?? null,
        },
      ]
    })
  )

  const newPosts = posts.filter((p) => !cachedById.has(p.id))
  const backfillPosts = posts.filter((p) => {
    const c = cachedById.get(p.id)
    return c !== undefined && c.topic === null && c.category !== 'other'
  })

  const indexById = new Map(posts.map((p, i) => [p.id, i]))

  // Usage-credit gate (margin guard) — charge per Haiku classify/backfill BATCH,
  // and only when there's actual Claude work (all-cached re-scans cost nothing,
  // so they're free). Gate BEFORE streaming so we can return a real 402.
  const scanUnits =
    Math.ceil(newPosts.length / CLASSIFY_BATCH_SIZE) +
    Math.ceil(backfillPosts.length / CLASSIFY_BATCH_SIZE)
  if (scanUnits > 0) {
    const over = await gateUsage(db, await activeProjectId(), 'scan', { units: scanUnits })
    if (over) return over
  }

  // Pre-flight done — switch to streaming. The work below issues Claude calls
  // sequentially (throttled in lib/claude.ts) and emits progress per post.
  return ndjsonStream(async (sink) => {
    sink.send({
      type: 'status',
      newCount: newPosts.length,
      cachedCount: cachedById.size,
      backfillCount: backfillPosts.length,
    })

    // 1. Emit cached posts immediately — no Claude call, no waiting. Posts
    //    awaiting topic backfill go out with topic: null and get re-emitted
    //    later with their extracted topic; the client replaces by id.
    for (let i = 0; i < posts.length; i++) {
      const p = posts[i]
      const cached = cachedById.get(p.id)
      if (!cached) continue
      sink.send({
        type: 'post',
        index: i,
        post: {
          ...p,
          category: cached.category,
          topic: cached.topic,
          analyzedAt: cached.analyzedAt,
          tools: cached.tools,
          quotes: cached.quotes,
          commentsScannedAt: cached.commentsScannedAt,
          commentsSampled: cached.commentsSampled,
          confidence: cached.confidence,
        },
      })
    }

    // Fetch known-topic vocabulary + few-shot classification examples in
    // parallel. Both are single Supabase reads (no Claude). Examples are
    // built ONCE per scan and reused for every classifyPost call.
    let knownTopics: string[] = []
    let examples: ExampleSet | undefined
    if (newPosts.length > 0 || backfillPosts.length > 0) {
      const [topicRowsRes, exampleSet] = await Promise.all([
        db.from('posts').select('topic').not('topic', 'is', null).limit(5000),
        newPosts.length > 0
          ? fetchClassificationExamples(db, subreddit)
          : Promise.resolve(undefined),
      ])
      if (topicRowsRes.data) {
        const counts = new Map<string, number>()
        for (const r of topicRowsRes.data) {
          const t = r.topic as string | null
          if (!t) continue
          counts.set(t, (counts.get(t) ?? 0) + 1)
        }
        knownTopics = Array.from(counts.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 100)
          .map(([t]) => t)
      }
      examples = exampleSet
    }

    // 2. Classify new posts in batches (one throttled Claude call per batch of
    //    CLASSIFY_BATCH_SIZE, vs one-or-two per post before). Per-batch upsert so
    //    a client abort mid-scan still persists every batch completed up to that
    //    point. Check req.signal before each batch so we don't burn API budget on
    //    posts the user no longer wants.
    if (newPosts.length > 0) {
      sink.send({ type: 'progress', phase: 'classify', current: 0, total: newPosts.length })
      let done = 0
      for (let start = 0; start < newPosts.length; start += CLASSIFY_BATCH_SIZE) {
        if (req.signal.aborted) break
        const batch = newPosts.slice(start, start + CLASSIFY_BATCH_SIZE)
        const results = await classifyAndExtractBatch(
          batch.map((p) => ({ title: p.title, selftext: p.selftext })),
          { examples, knownTopics, priority },
        )
        const rows = batch.map((p, j) => ({
          post_id: p.id,
          subreddit,
          title: p.title,
          selftext: p.selftext,
          author: p.author,
          permalink: p.permalink,
          category: results[j].category,
          topic: results[j].topic,
          confidence: results[j].confidence,
          posted_at: p.postedAt ? new Date(p.postedAt).toISOString() : null,
        }))
        const { error: insertError } = await db
          .from('posts')
          .upsert(rows, { onConflict: 'post_id,subreddit', ignoreDuplicates: true })
        if (insertError) console.error('[supabase] insert error:', insertError)
        for (let j = 0; j < batch.length; j++) {
          const p = batch[j]
          const r = results[j]
          sink.send({
            type: 'post',
            index: indexById.get(p.id)!,
            post: {
              ...p,
              category: r.category,
              topic: r.topic,
              analyzedAt: Date.now(),
              tools: null,
              quotes: null,
              commentsScannedAt: null,
              commentsSampled: null,
              confidence: r.confidence,
            },
          })
        }
        done += batch.length
        sink.send({ type: 'progress', phase: 'classify', current: done, total: newPosts.length })
      }
    }

    // 3. Backfill topics on previously-classified cached posts — batched,
    //    topic-only (categories are already known and never change here).
    //    Per-batch upsert. Re-emit each post with its newly-extracted topic;
    //    the client replaces by id.
    if (backfillPosts.length > 0) {
      sink.send({ type: 'progress', phase: 'backfill', current: 0, total: backfillPosts.length })
      let done = 0
      for (let start = 0; start < backfillPosts.length; start += CLASSIFY_BATCH_SIZE) {
        if (req.signal.aborted) break
        const batch = backfillPosts.slice(start, start + CLASSIFY_BATCH_SIZE)
        const topics = await extractTopicsBatch(
          batch.map((p) => ({ title: p.title, selftext: p.selftext })),
          knownTopics,
          priority,
        )
        const rows = batch
          .map((p, j) => ({ p, topic: topics[j], cached: cachedById.get(p.id)! }))
          .filter((x) => x.topic !== null)
          .map(({ p, topic, cached }) => ({
            post_id: p.id,
            subreddit,
            title: p.title,
            selftext: p.selftext,
            author: p.author,
            permalink: p.permalink,
            category: cached.category,
            topic,
            // Backfill posted_at on legacy rows that pre-date the Atom
            // <published> capture. Newer rows already have it; the value
            // doesn't change between scans so re-writing is safe.
            posted_at: p.postedAt ? new Date(p.postedAt).toISOString() : null,
          }))
        if (rows.length > 0) {
          const { error: updateError } = await db
            .from('posts')
            .upsert(rows, { onConflict: 'post_id,subreddit' })
          if (updateError) console.error('[supabase] topic backfill error:', updateError)
        }
        for (let j = 0; j < batch.length; j++) {
          const p = batch[j]
          const cached = cachedById.get(p.id)!
          sink.send({
            type: 'post',
            index: indexById.get(p.id)!,
            // Preserve the original analyzed_at so the topic-update doesn't make
            // the post jump to the top of the list. Same for cached insights.
            post: {
              ...p,
              category: cached.category,
              topic: topics[j],
              analyzedAt: cached.analyzedAt,
              tools: cached.tools,
              quotes: cached.quotes,
              commentsScannedAt: cached.commentsScannedAt,
              commentsSampled: cached.commentsSampled,
              confidence: cached.confidence,
            },
          })
        }
        done += batch.length
        sink.send({ type: 'progress', phase: 'backfill', current: done, total: backfillPosts.length })
      }
    }

    // Done event just signals end + carries pagination cursor; the post list
    // has already been streamed via individual `post` events above.
    sink.send({ type: 'done', nextAfter })
  })
}
