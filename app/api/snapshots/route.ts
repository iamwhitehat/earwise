import type { NextRequest } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { fetchTopicSnapshots } from '@/lib/snapshots'

const DEFAULT_WEEKS = 8
const MAX_WEEKS = 26
const MAX_TOPICS = 50

// GET /api/snapshots?topics=topic+a,topic+b&weeks=8
// Returns: { [topic]: WeekSnapshot[] } sorted by week_start ASC.
// Topics not in the snapshots table yet come back as empty arrays.

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const topicsParam = url.searchParams.get('topics') ?? ''
  const weeksRaw = Number(url.searchParams.get('weeks') ?? DEFAULT_WEEKS)
  const weeks = Math.max(1, Math.min(MAX_WEEKS, Number.isFinite(weeksRaw) ? Math.floor(weeksRaw) : DEFAULT_WEEKS))

  const topics = Array.from(
    new Set(
      topicsParam
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t.length > 0),
    ),
  ).slice(0, MAX_TOPICS)

  if (topics.length === 0) return Response.json({})

  let db
  try {
    db = getSupabase()
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Configuration error' },
      { status: 500 }
    )
  }

  try {
    const result = await fetchTopicSnapshots(db, topics, weeks)
    return Response.json(result)
  } catch (err) {
    console.error('[snapshots] fetch error:', err)
    return Response.json(
      {
        error: 'Snapshot fetch failed — confirm the trend_snapshots table exists. See SETUP.md (2b-septies).',
      },
      { status: 500 }
    )
  }
}
