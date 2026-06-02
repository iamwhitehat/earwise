// Shared server-side loader for high-intent signals (posts + comments matching
// the buying-intent patterns). Extracted from app/api/signals/route.ts so the
// hot-now feed (lib/hot-signals + /api/hot-signals) reuses the exact same
// intent filter + findFirstMatch tagging.
import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Category } from './categories'
import { patternsFor, findFirstMatch, type IntentType } from './intent-patterns'

const PER_SOURCE_CAP = 100

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
  permalink: string
}

export type LoadSignalsOpts = {
  sub?: string
  intent?: IntentType | 'all'
  /** Recency window in ms (null/undefined = all time). */
  ageMs?: number | null
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

  let postsQuery = db
    .from('posts')
    .select('post_id, subreddit, author, title, selftext, category, topic, analyzed_at')
    .or(buildOrFilter(['title', 'selftext'], phrases))
    .order('analyzed_at', { ascending: false })
    .limit(PER_SOURCE_CAP)
  if (opts.sub) postsQuery = postsQuery.eq('subreddit', opts.sub)
  if (cutoffIso) postsQuery = postsQuery.gte('analyzed_at', cutoffIso)

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

  type PostMeta = { category: Category; topic: string | null }
  const postMeta = new Map<string, PostMeta>()
  for (const row of postsRes.data ?? []) {
    postMeta.set(row.post_id as string, {
      category: row.category as Category,
      topic: (row.topic as string | null) ?? null,
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
      permalink: `https://www.reddit.com/r/${subreddit}/comments/${id}/`,
    })
  }

  for (const row of commentsRes.data ?? []) {
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
      permalink: `https://www.reddit.com/r/${subreddit}/comments/${postId}/`,
    })
  }

  signals.sort((a, b) => b.analyzedAt - a.analyzedAt)
  return signals
}
