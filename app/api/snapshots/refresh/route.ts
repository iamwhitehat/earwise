import { getSupabase } from '@/lib/supabase'
import { recomputeCurrentWeekSnapshots } from '@/lib/snapshots'
import { backfillCanonicalTopics } from '@/lib/topics-db'

// POST /api/snapshots/refresh — recompute the current week's trend_snapshots
// rows from posts. Idempotent. Called best-effort by the client after every
// scanAll and loadMore so the week's row stays current. Cheap: one read +
// one batch upsert. Failure is logged + returned but doesn't block scans.

export async function POST() {
  let db
  try {
    db = getSupabase()
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Configuration error' },
      { status: 500 }
    )
  }

  // Opportunistically fill canonical_topic for any new/legacy rows. Tolerant
  // (soft-skips if the column isn't migrated) and never blocks the snapshot
  // recompute — hence its own try/catch.
  try {
    await backfillCanonicalTopics(db)
  } catch (err) {
    console.warn('[snapshots/refresh] canonical backfill skipped:', err)
  }

  try {
    const count = await recomputeCurrentWeekSnapshots(db)
    return Response.json({ ok: true, upserted: count ?? 0 })
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Snapshot refresh failed'
    console.error('[snapshots/refresh] error:', err)
    return Response.json(
      {
        error: `${message} — confirm the trend_snapshots table exists. See SETUP.md (2b-septies).`,
      },
      { status: 500 },
    )
  }
}
