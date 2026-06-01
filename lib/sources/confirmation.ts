// Cross-source confirmation: which distinct sources have ≥1 signal per
// canonical topic. A pain confirmed in several sources is a fact; in one it's
// an anecdote — so this feeds opportunity/insight confidence.
import type { SupabaseClient } from '@supabase/supabase-js'
import { canonicalTopic } from '../topics'

const MAX_SIGNALS = 20_000

/**
 * Map canonical topic → sorted list of distinct sources that mention it,
 * read from the unified `signals` table. Tolerant: returns {} if the table
 * isn't migrated yet (the Reddit-only pipeline still works).
 */
export async function crossSourceConfirmation(
  db: SupabaseClient,
): Promise<Record<string, string[]>> {
  const { data, error } = await db
    .from('signals')
    .select('source, canonical_topic, topic')
    .limit(MAX_SIGNALS)

  if (error) {
    console.warn('[confirmation] signals read failed:', error.message)
    return {}
  }

  const map = new Map<string, Set<string>>()
  for (const row of data ?? []) {
    const canonical =
      (row.canonical_topic as string | null) ?? canonicalTopic(row.topic as string | null)
    if (!canonical) continue
    const source = row.source as string
    let set = map.get(canonical)
    if (!set) {
      set = new Set()
      map.set(canonical, set)
    }
    set.add(source)
  }

  const out: Record<string, string[]> = {}
  for (const [topic, sources] of map) out[topic] = Array.from(sources).sort()
  return out
}
