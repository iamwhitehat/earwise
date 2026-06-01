import { getSupabase } from '@/lib/supabase'
import { backfillCanonicalTopics } from '@/lib/topics-db'

// POST /api/topics/backfill — populate canonical_topic for rows missing it.
// Idempotent + tolerant: a no-op once everything is backfilled, and a soft
// skip (not an error) if the column hasn't been migrated yet. Safe to call
// repeatedly; processes up to one batch per call.
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

  try {
    const result = await backfillCanonicalTopics(db)
    if (!result.ok) {
      return Response.json(
        { ok: false, skipped: true, reason: result.reason, hint: 'Run SETUP.md §2b-undecies.' },
      )
    }
    return Response.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Backfill failed'
    console.error('[topics/backfill] error:', err)
    return Response.json({ error: message }, { status: 500 })
  }
}
