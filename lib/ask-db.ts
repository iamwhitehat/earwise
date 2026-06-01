// Retrieval for "Ask your market" — pulls candidate rows from the indexed
// signals + posts via keyword ILIKE, normalized to MarketSource. Tolerant: a
// missing table contributes nothing.
import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { MarketSource } from './ask'

const PER_TABLE_LIMIT = 40

// PostgREST or() ilike uses `*` as the wildcard. Keywords are already
// [a-z0-9]-only (see extractKeywords), so they're safe to interpolate.
function orFilter(keywords: string[], columns: string[]): string {
  const parts: string[] = []
  for (const k of keywords) for (const c of columns) parts.push(`${c}.ilike.*${k}*`)
  return parts.join(',')
}

export async function retrieveMarketSources(
  db: SupabaseClient,
  keywords: string[],
): Promise<MarketSource[]> {
  if (keywords.length === 0) return []
  const out: MarketSource[] = []

  // Multi-source signals (Phase 3 connectors).
  try {
    const { data } = await db
      .from('signals')
      .select('title, body, author, url, source, topic')
      .or(orFilter(keywords, ['title', 'body', 'topic']))
      .order('ingested_at', { ascending: false })
      .limit(PER_TABLE_LIMIT)
    for (const r of data ?? []) {
      out.push({
        title: (r.title as string) ?? '',
        snippet: (r.body as string) ?? '',
        url: (r.url as string) ?? '',
        author: (r.author as string) ?? '',
        subreddit: '',
        source: (r.source as string) ?? 'signal',
      })
    }
  } catch {
    /* signals table absent */
  }

  // Reddit posts.
  try {
    const { data } = await db
      .from('posts')
      .select('title, selftext, author, permalink, subreddit, topic')
      .or(orFilter(keywords, ['title', 'selftext', 'topic']))
      .order('analyzed_at', { ascending: false })
      .limit(PER_TABLE_LIMIT)
    for (const r of data ?? []) {
      out.push({
        title: (r.title as string) ?? '',
        snippet: (r.selftext as string) ?? '',
        url: (r.permalink as string) ?? '',
        author: (r.author as string) ?? '',
        subreddit: (r.subreddit as string) ?? '',
        source: 'reddit',
      })
    }
  } catch {
    /* posts table absent */
  }

  return out
}
