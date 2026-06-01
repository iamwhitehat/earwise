import type { SupabaseClient } from '@supabase/supabase-js'
import type { Category } from './categories'
import { canonicalTopic } from './topics'
import { dedupePosts } from './dedup'

export type WeekSnapshot = {
  topic: string
  weekStart: string // 'YYYY-MM-DD'
  postCount: number
  painCount: number
  featureCount: number
  complaintCount: number
  subredditCount: number
  opportunityScore: number
}

export type Direction = 'new' | 'declining' | 'stable' | 'rising' | 'accelerating'

const MAX_POSTS_THIS_WEEK = 20_000

/** Returns the ISO Monday (00:00 UTC) of the week containing `ts`. */
export function isoWeekStart(ts: number): Date {
  const d = new Date(ts)
  d.setUTCHours(0, 0, 0, 0)
  const daysFromMonday = (d.getUTCDay() + 6) % 7 // Sun=0→6, Mon=1→0, …, Sat=6→5
  d.setUTCDate(d.getUTCDate() - daysFromMonday)
  return d
}

/** Format a Date as 'YYYY-MM-DD' (UTC). */
export function dateToYmd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * Recompute the current week's snapshots from the `posts` table. Idempotent —
 * always reflects ground truth at call time. Called after every user-initiated
 * scan / load-more so the week's row is always current.
 *
 * Buckets by the Reddit post's `posted_at` (true creation time from the
 * Atom feed). Legacy rows that pre-date the posted_at capture fall back to
 * `analyzed_at`. Note: only the *current* week is recomputed here; if a
 * historical week's true post counts change because a backfill adds
 * posted_at to old rows, that earlier week's snapshot stays stale until
 * recompute is extended to walk past weeks too.
 *
 * Returns the number of (topic, week) rows upserted, or null if no posts
 * exist for the current week yet.
 */
export async function recomputeCurrentWeekSnapshots(
  db: SupabaseClient,
): Promise<number | null> {
  const weekStart = isoWeekStart(Date.now())
  const weekStartYmd = dateToYmd(weekStart)
  const weekStartIso = weekStart.toISOString()

  // Fetch posts whose true Reddit date is in this week, PLUS legacy rows
  // (posted_at IS NULL) that were analyzed this week — the analyzed_at
  // fallback keeps pre-migration data flowing into snapshots until those
  // rows get backfilled by the topic-backfill upsert in posts/[subreddit].
  const { data, error } = await db
    .from('posts')
    .select('topic, subreddit, category, posted_at, analyzed_at, title, author')
    .not('topic', 'is', null)
    .or(
      `posted_at.gte.${weekStartIso},and(posted_at.is.null,analyzed_at.gte.${weekStartIso})`,
    )
    .limit(MAX_POSTS_THIS_WEEK)

  if (error) {
    console.error('[snapshots] posts read failed:', error)
    throw new Error(`Snapshot recompute read failed: ${error.message}`)
  }
  if (!data || data.length === 0) return null

  type Agg = {
    posts: number
    pain: number
    feature: number
    complaint: number
    subs: Set<string>
  }
  const agg = new Map<string, Agg>()

  // Drop crossposts/near-duplicates before counting, then bucket by canonical
  // topic so the week's snapshot matches the (also-canonical) live trends.
  const deduped = dedupePosts(
    data.map((row) => ({
      topic: row.topic as string | null,
      subreddit: row.subreddit as string,
      category: row.category as Category,
      posted_at: row.posted_at as string | null,
      analyzed_at: row.analyzed_at as string | null,
      title: (row.title as string | null) ?? '',
      author: (row.author as string | null) ?? '',
    })),
  )

  for (const row of deduped) {
    // Belt-and-suspenders: the SQL filter already narrows by date, but if a
    // row's posted_at is in a different week (which can happen on the edge
    // of the legacy fallback), drop it here. Bucketing truth is posted_at,
    // falling back to analyzed_at when null.
    const truthIso = row.posted_at ?? row.analyzed_at
    if (!truthIso) continue
    if (truthIso < weekStartIso) continue

    const topic = canonicalTopic(row.topic)
    if (!topic) continue
    let e = agg.get(topic)
    if (!e) {
      e = { posts: 0, pain: 0, feature: 0, complaint: 0, subs: new Set() }
      agg.set(topic, e)
    }
    e.posts++
    e.subs.add(row.subreddit)
    const cat = row.category
    if (cat === 'pain_point') e.pain++
    else if (cat === 'feature_request') e.feature++
    else if (cat === 'tool_complaint') e.complaint++
  }

  const rows = Array.from(agg.entries()).map(([topic, e]) => {
    const total = e.posts || 1
    const ratio = (e.pain + e.feature) / total
    const score = Math.min(10, e.posts * 1.5 + e.subs.size * 1.5 + ratio * 3)
    return {
      topic,
      week_start: weekStartYmd,
      post_count: e.posts,
      pain_count: e.pain,
      feature_count: e.feature,
      complaint_count: e.complaint,
      subreddit_count: e.subs.size,
      opportunity_score: Number(score.toFixed(2)),
    }
  })

  if (rows.length === 0) return 0

  const { error: upsertErr } = await db
    .from('trend_snapshots')
    .upsert(rows, { onConflict: 'topic,week_start' })
  if (upsertErr) {
    console.error('[snapshots] upsert failed:', upsertErr)
    throw new Error(`Snapshot upsert failed: ${upsertErr.message}`)
  }
  return rows.length
}

/**
 * Direction from a series of week-over-week post counts (chronological order).
 * - 'new'           — <2 weeks of history
 * - 'accelerating'  — ≥3 weeks, deltas strictly increasing AND latest positive
 * - 'rising'        — last week vs prev > +20%
 * - 'declining'     — last week vs prev < -20%
 * - 'stable'        — within ±20% of prev
 */
export function computeDirection(weeklyCounts: number[]): Direction {
  const n = weeklyCounts.length
  if (n < 2) return 'new'
  const cur = weeklyCounts[n - 1]
  const prev = weeklyCounts[n - 2]

  if (n >= 3) {
    const prev2 = weeklyCounts[n - 3]
    const delta1 = prev - prev2
    const delta2 = cur - prev
    if (delta2 > delta1 && delta2 > 0) return 'accelerating'
  }

  const pct = prev > 0 ? (cur - prev) / prev : cur > 0 ? 1 : 0
  if (pct > 0.2) return 'rising'
  if (pct < -0.2) return 'declining'
  return 'stable'
}

/**
 * Fetch the last N weeks of snapshots for a given set of topics.
 * Returns chronologically-ordered arrays per topic.
 */
export async function fetchTopicSnapshots(
  db: SupabaseClient,
  topics: string[],
  weeks: number,
): Promise<Record<string, WeekSnapshot[]>> {
  if (topics.length === 0) return {}
  // window: today minus (weeks-1)*7 days, rounded back to Monday
  const earliestWeekStart = isoWeekStart(Date.now() - (weeks - 1) * 7 * 24 * 60 * 60 * 1000)
  const earliestYmd = dateToYmd(earliestWeekStart)

  const { data, error } = await db
    .from('trend_snapshots')
    .select(
      'topic, week_start, post_count, pain_count, feature_count, complaint_count, subreddit_count, opportunity_score',
    )
    .in('topic', topics)
    .gte('week_start', earliestYmd)
    .order('week_start', { ascending: true })

  if (error) throw new Error(`Snapshot fetch failed: ${error.message}`)

  const out: Record<string, WeekSnapshot[]> = {}
  for (const t of topics) out[t] = []
  for (const row of data ?? []) {
    const topic = row.topic as string
    if (!out[topic]) continue
    out[topic].push({
      topic,
      weekStart: row.week_start as string,
      postCount: (row.post_count as number) ?? 0,
      painCount: (row.pain_count as number) ?? 0,
      featureCount: (row.feature_count as number) ?? 0,
      complaintCount: (row.complaint_count as number) ?? 0,
      subredditCount: (row.subreddit_count as number) ?? 0,
      opportunityScore: Number(row.opportunity_score) || 0,
    })
  }
  return out
}
