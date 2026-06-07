import type { SupabaseClient } from '@supabase/supabase-js'
import { redditPermalink } from './evidence'

// Unified demand rows from BOTH demand tables, so a build view sees the data no
// matter how it was scanned:
//   - `posts`   ← the interactive app "Scan for new" (Reddit, comment-rich)
//   - `signals` ← the multi-source API ingest (reddit/HN/SO, year-deep search)
// Deduped by url so a reddit post present in both isn't double-counted. The
// fix for "I scanned in the app but the Build screen stayed empty".
export type DemandRow = {
  title: string
  body: string
  url: string
  author: string
  category: string
  topic: string | null
  source: string
}

const DEMAND_CATEGORIES = ['pain_point', 'feature_request', 'tool_complaint']
const CAP = 10000
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

async function loadPostsDemand(db: SupabaseClient): Promise<DemandRow[]> {
  const { data, error } = await db
    .from('posts')
    .select('post_id, subreddit, title, selftext, author, category, topic, canonical_topic, permalink')
    .in('category', DEMAND_CATEGORIES)
    .order('analyzed_at', { ascending: false })
    .limit(CAP)
  if (error || !data) return []
  return data.map((r) => {
    const row = r as Record<string, unknown>
    return {
      title: str(row.title),
      body: str(row.selftext),
      url: str(row.permalink) || redditPermalink(str(row.subreddit), str(row.post_id)),
      author: str(row.author),
      category: str(row.category),
      topic: (row.canonical_topic as string | null) ?? (row.topic as string | null) ?? null,
      source: 'reddit',
    }
  })
}

async function loadSignalsDemand(db: SupabaseClient, source?: string | null): Promise<DemandRow[]> {
  let q = db
    .from('signals')
    .select('source, title, body, author, category, topic, canonical_topic, url')
    .in('category', DEMAND_CATEGORIES)
    .order('ingested_at', { ascending: false })
    .limit(CAP)
  if (source) q = q.eq('source', source)
  const { data, error } = await q
  if (error || !data) return []
  return data.map((r) => {
    const row = r as Record<string, unknown>
    return {
      title: str(row.title),
      body: str(row.body),
      url: str(row.url),
      author: str(row.author),
      category: str(row.category),
      topic: (row.canonical_topic as string | null) ?? (row.topic as string | null) ?? null,
      source: str(row.source) || 'reddit',
    }
  })
}

export async function loadDemandRows(
  db: SupabaseClient,
  opts: { source?: string | null } = {},
): Promise<DemandRow[]> {
  const tasks: Promise<DemandRow[]>[] = [loadSignalsDemand(db, opts.source)]
  // `posts` is Reddit-only; skip it when a non-reddit source filter is set.
  if (!opts.source || opts.source === 'reddit') tasks.unshift(loadPostsDemand(db))

  const all = (await Promise.all(tasks)).flat()
  const seen = new Set<string>()
  const out: DemandRow[] = []
  for (const r of all) {
    const key = r.url || `${r.title}|${r.author}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(r)
  }
  return out
}
