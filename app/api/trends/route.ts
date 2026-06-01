import type { NextRequest } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { canonicalTopic } from '@/lib/topics'
import { dedupePosts } from '@/lib/dedup'

export type Trend = {
  topic: string
  count: number
  subreddits: string[]
}

export async function GET(_req: NextRequest) {
  let db
  try {
    db = getSupabase()
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Configuration error' },
      { status: 500 }
    )
  }

  const { data, error } = await db
    .from('posts')
    .select('topic, subreddit, title, author')
    .not('topic', 'is', null)
    .limit(5000)

  if (error) {
    console.error('[supabase] trends query error:', error)
    return Response.json({ error: 'Database query failed' }, { status: 500 })
  }

  // Drop crossposts/near-duplicates before counting, then group by the
  // canonical topic so plural/synonym variants land in one trend.
  const rows = dedupePosts(
    (data ?? []).map((r) => ({
      topic: r.topic as string | null,
      subreddit: r.subreddit as string,
      title: (r.title as string | null) ?? '',
      author: (r.author as string | null) ?? '',
    })),
  )

  const map = new Map<string, { count: number; subreddits: Set<string> }>()
  for (const row of rows) {
    const topic = canonicalTopic(row.topic)
    if (!topic) continue
    let entry = map.get(topic)
    if (!entry) {
      entry = { count: 0, subreddits: new Set() }
      map.set(topic, entry)
    }
    entry.count++
    entry.subreddits.add(row.subreddit)
  }

  const trends: Trend[] = Array.from(map.entries())
    .filter(([, v]) => v.count >= 2)
    .map(([topic, v]) => ({
      topic,
      count: v.count,
      subreddits: Array.from(v.subreddits).sort(),
    }))
    .sort((a, b) => b.count - a.count)

  return Response.json(trends)
}
