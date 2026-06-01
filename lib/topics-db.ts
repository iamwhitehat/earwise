// Server-side canonical_topic backfill. Kept out of lib/topics.ts so that
// module stays Supabase-free + unit-testable.
import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { canonicalTopic } from './topics'

const BACKFILL_BATCH = 5000

export type BackfillResult =
  | { ok: true; scanned: number; updated: number }
  | { ok: false; skipped: true; reason: string }

function isMissingColumn(message: string): boolean {
  return /column .*canonical_topic.* does not exist/i.test(message) ||
    /canonical_topic/.test(message) && /does not exist/i.test(message)
}

/**
 * Populate `canonical_topic` for rows that have a `topic` but no canonical yet.
 * Tolerant: if the column hasn't been migrated, returns `{ ok:false, skipped }`
 * instead of throwing, so callers (e.g. the post-scan hook) can ignore it.
 *
 * Groups updates by canonical value (a few dozen distinct labels) so the whole
 * backfill is a handful of `UPDATE ... WHERE post_id IN (...)` statements
 * rather than one per row.
 */
export async function backfillCanonicalTopics(db: SupabaseClient): Promise<BackfillResult> {
  const { data, error } = await db
    .from('posts')
    .select('post_id, topic')
    .not('topic', 'is', null)
    .is('canonical_topic', null)
    .limit(BACKFILL_BATCH)

  if (error) {
    if (isMissingColumn(error.message)) {
      return { ok: false, skipped: true, reason: 'canonical_topic column not migrated' }
    }
    throw new Error(`canonical backfill read failed: ${error.message}`)
  }

  const rows = data ?? []
  if (rows.length === 0) return { ok: true, scanned: 0, updated: 0 }

  // canonical label -> post_ids
  const groups = new Map<string, string[]>()
  for (const r of rows) {
    const canonical = canonicalTopic(r.topic as string | null)
    if (!canonical) continue
    let ids = groups.get(canonical)
    if (!ids) {
      ids = []
      groups.set(canonical, ids)
    }
    ids.push(r.post_id as string)
  }

  let updated = 0
  for (const [canonical, ids] of groups) {
    const { error: updErr } = await db
      .from('posts')
      .update({ canonical_topic: canonical })
      .in('post_id', ids)
    if (updErr) {
      if (isMissingColumn(updErr.message)) {
        return { ok: false, skipped: true, reason: 'canonical_topic column not migrated' }
      }
      throw new Error(`canonical backfill update failed: ${updErr.message}`)
    }
    updated += ids.length
  }

  return { ok: true, scanned: rows.length, updated }
}
