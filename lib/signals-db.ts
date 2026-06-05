// Shared server-side loader for high-intent signals (posts + comments matching
// the buying-intent patterns). Extracted from app/api/signals/route.ts so the
// hot-now feed (lib/hot-signals + /api/hot-signals) reuses the exact same
// intent filter + findFirstMatch tagging.
import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Category } from './categories'
import { patternsFor, findFirstMatch, type IntentType } from './intent-patterns'
import { canonicalTopic } from './topics'
import { tsToMs, subredditFromUrl } from './signals-util'

const PER_SOURCE_CAP = 100
const TOPIC_VOCAB_CAP = 5000

export type SignalRow = {
  kind: 'post' | 'comment'
  id: string // post_id or comment_id
  post_id: string
  subreddit: string
  author: string
  text: string
  matchedPhrase: string
  intentType: IntentType
  category: Category
  topic: string | null
  analyzedAt: number
  /** True creation time at the source (epoch ms) when known — Reddit's post
   *  time, NOT when we scanned it. null when unknown (legacy rows / comments
   *  whose parent post wasn't loaded). Recency scoring prefers this over
   *  analyzedAt so a 6-day-old thread can't masquerade as fresh. */
  postedAt?: number | null
  permalink: string
}

export type LoadSignalsOpts = {
  sub?: string
  intent?: IntentType | 'all'
  /** Recency window in ms (null/undefined = all time). */
  ageMs?: number | null
  /**
   * Canonical topic to scope to (the "Act on this opportunity" link). Applied
   * at the SQL level so the per-source cap fills from the topic's rows, not a
   * topic-blind recency window. When set, only posts are returned (comments
   * carry no topic column of their own).
   */
  topicTarget?: string | null
}

// PostgREST .or() ilike uses `*` as the wildcard. Strip grammar chars for safety.
function buildOrFilter(columns: string[], phrases: string[]): string {
  const clauses: string[] = []
  for (const phrase of phrases) {
    const safe = phrase.replace(/[*(),]/g, '')
    for (const col of columns) clauses.push(`${col}.ilike.*${safe}*`)
  }
  return clauses.join(',')
}

/**
 * Load high-intent signals, newest first. Throws on a DB error so callers can
 * surface a migration hint. Empty list when the chosen intent has no patterns.
 */
export async function loadSignals(db: SupabaseClient, opts: LoadSignalsOpts = {}): Promise<SignalRow[]> {
  const intent = opts.intent ?? 'all'
  const patterns = patternsFor(intent)
  if (patterns.length === 0) return []
  const phrases = patterns.map((p) => p.phrase)
  const cutoffIso = opts.ageMs != null ? new Date(Date.now() - opts.ageMs).toISOString() : null
  const topicTarget = opts.topicTarget ?? null

  // Resolve the canonical topic to the raw `topic` values stored on posts (topic
  // is stored raw; canonicalTopic can't run in SQL). Lets us filter at the DB
  // level so the cap fills from this topic's rows.
  let rawTopics: string[] | null = null
  if (topicTarget) {
    const { data: vocab } = await db
      .from('posts')
      .select('topic')
      .not('topic', 'is', null)
      .limit(TOPIC_VOCAB_CAP)
    rawTopics = Array.from(
      new Set(
        (vocab ?? [])
          .map((r) => r.topic as string)
          .filter((t) => canonicalTopic(t) === topicTarget),
      ),
    )
    if (rawTopics.length === 0) return [] // no posts on this topic
  }

  let postsQuery = db
    .from('posts')
    .select('post_id, subreddit, author, title, selftext, category, topic, analyzed_at, posted_at')
    .or(buildOrFilter(['title', 'selftext'], phrases))
    .order('analyzed_at', { ascending: false })
    .limit(PER_SOURCE_CAP)
  if (opts.sub) postsQuery = postsQuery.eq('subreddit', opts.sub)
  if (cutoffIso) postsQuery = postsQuery.gte('analyzed_at', cutoffIso)
  if (rawTopics) postsQuery = postsQuery.in('topic', rawTopics)

  let commentsQuery = db
    .from('post_comments')
    .select('comment_id, post_id, subreddit, author, body, category, analyzed_at')
    .or(buildOrFilter(['body'], phrases))
    .order('analyzed_at', { ascending: false })
    .limit(PER_SOURCE_CAP)
  if (opts.sub) commentsQuery = commentsQuery.eq('subreddit', opts.sub)
  if (cutoffIso) commentsQuery = commentsQuery.gte('analyzed_at', cutoffIso)

  const [postsRes, commentsRes] = await Promise.all([postsQuery, commentsQuery])
  if (postsRes.error || commentsRes.error) {
    const err = postsRes.error ?? commentsRes.error
    throw new Error(
      `Database query failed: ${err?.message}. If the message names a missing column or table, run the matching SETUP.md migration.`,
    )
  }

  type PostMeta = { category: Category; topic: string | null; postedAt: number | null }
  const postMeta = new Map<string, PostMeta>()
  for (const row of postsRes.data ?? []) {
    postMeta.set(row.post_id as string, {
      category: row.category as Category,
      topic: (row.topic as string | null) ?? null,
      postedAt: tsToMs(row.posted_at),
    })
  }

  const signals: SignalRow[] = []

  for (const row of postsRes.data ?? []) {
    const text = `${row.title as string}\n${(row.selftext as string | null) ?? ''}`
    const match = findFirstMatch(text, patterns)
    if (!match) continue
    const id = row.post_id as string
    const subreddit = row.subreddit as string
    signals.push({
      kind: 'post',
      id,
      post_id: id,
      subreddit,
      author: (row.author as string) || 'unknown',
      text: text.trim(),
      matchedPhrase: match.phrase,
      intentType: match.intentType,
      category: row.category as Category,
      topic: (row.topic as string | null) ?? null,
      analyzedAt: new Date(row.analyzed_at as string).getTime(),
      postedAt: tsToMs(row.posted_at),
      permalink: `https://www.reddit.com/r/${subreddit}/comments/${id}/`,
    })
  }

  // Comments have no topic column; skip them entirely when scoping to a topic.
  for (const row of topicTarget ? [] : commentsRes.data ?? []) {
    const body = (row.body as string | null) ?? ''
    const match = findFirstMatch(body, patterns)
    if (!match) continue
    const id = row.comment_id as string
    const postId = row.post_id as string
    const subreddit = row.subreddit as string
    const inheritedMeta = postMeta.get(postId)
    const category = (row.category as Category | null) ?? inheritedMeta?.category ?? 'other'
    signals.push({
      kind: 'comment',
      id,
      post_id: postId,
      subreddit,
      author: (row.author as string) || 'unknown',
      text: body.trim(),
      matchedPhrase: match.phrase,
      intentType: match.intentType,
      category,
      topic: inheritedMeta?.topic ?? null,
      analyzedAt: new Date(row.analyzed_at as string).getTime(),
      // A comment carries no creation time of its own; inherit the parent
      // post's true post time when we loaded it, else leave unknown.
      postedAt: inheritedMeta?.postedAt ?? null,
      permalink: `https://www.reddit.com/r/${subreddit}/comments/${postId}/`,
    })
  }

  signals.sort((a, b) => b.analyzedAt - a.analyzedAt)
  return signals
}

/**
 * Load high-intent signals from the unified `signals` table (the multi-source
 * ingest target the cron + external scheduler write to — ingest.ts). This is
 * the table the hot path was NOT reading: the cron upserts here while loadSignals
 * reads `posts`/`post_comments`, so cron/scheduler-ingested demand never reached
 * Hot-now. Reddit-only (the Reply-now flow is Reddit), tolerant of a missing
 * table/column (returns [] so the legacy `posts` path still works), and uses the
 * stored `created_at` as the TRUE post time. Window filters on `ingested_at`
 * (the analog of analyzed_at) so the lane isn't emptied by tight true-age windows.
 */
export async function loadIngestedSignals(
  db: SupabaseClient,
  opts: { ageMs?: number | null; intent?: IntentType | 'all' } = {},
): Promise<SignalRow[]> {
  const patterns = patternsFor(opts.intent ?? 'all')
  if (patterns.length === 0) return []
  const phrases = patterns.map((p) => p.phrase)
  const cutoffIso = opts.ageMs != null ? new Date(Date.now() - opts.ageMs).toISOString() : null

  let q = db
    .from('signals')
    .select('external_id, title, body, author, url, category, topic, created_at, ingested_at')
    .eq('source', 'reddit')
    .or(buildOrFilter(['title', 'body'], phrases))
    .order('ingested_at', { ascending: false })
    .limit(PER_SOURCE_CAP)
  if (cutoffIso) q = q.gte('ingested_at', cutoffIso)

  const { data, error } = await q
  // Tolerant: a missing `signals` table/column must not break the legacy path.
  if (error || !data) return []

  const signals: SignalRow[] = []
  for (const row of data) {
    const url = (row.url as string | null) ?? ''
    const subreddit = subredditFromUrl(url)
    if (!subreddit) continue // can't address a reply without a subreddit
    const text = `${(row.title as string | null) ?? ''}\n${(row.body as string | null) ?? ''}`.trim()
    const match = findFirstMatch(text, patterns)
    if (!match) continue
    const id = row.external_id as string
    signals.push({
      kind: 'post',
      id,
      post_id: id,
      subreddit,
      author: (row.author as string) || 'unknown',
      text,
      matchedPhrase: match.phrase,
      intentType: match.intentType,
      category: (row.category as Category | null) ?? 'other',
      topic: (row.topic as string | null) ?? null,
      analyzedAt: tsToMs(row.ingested_at) ?? Date.now(),
      postedAt: tsToMs(row.created_at),
      permalink: url || `https://www.reddit.com/r/${subreddit}/comments/${id}/`,
    })
  }
  return signals
}
