// Server-side Business Memory access. Kept out of lib/memory.ts so that module
// stays pure/testable.
import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { BusinessProfile } from './strategy'
import {
  DEFAULT_PROJECT,
  PROFILE_KINDS,
  seedFactsFromProfile,
  renderMemoryDigest,
  type MemoryFact,
  type MemoryKind,
} from './memory'

/** Load all memory facts for a project. Tolerant: [] if the table is absent. */
export async function loadMemoryFacts(
  db: SupabaseClient,
  projectId: string = DEFAULT_PROJECT,
): Promise<MemoryFact[]> {
  const { data, error } = await db
    .from('business_memory')
    .select('kind, fact, weight')
    .eq('project_id', projectId)
    .limit(500)
  if (error) {
    console.warn('[memory] load failed:', error.message)
    return []
  }
  return (data ?? []).map((r) => ({
    kind: r.kind as MemoryKind,
    fact: (r.fact as string) ?? '',
    weight: typeof r.weight === 'number' ? r.weight : Number(r.weight) || 1,
  }))
}

/** Compact digest for prompt injection. '' when no memory / table absent. */
export async function memoryDigest(
  db: SupabaseClient,
  projectId: string = DEFAULT_PROJECT,
): Promise<string> {
  return renderMemoryDigest(await loadMemoryFacts(db, projectId))
}

/**
 * Re-seed the profile-derived facts from a saved profile. Replaces the
 * PROFILE_KINDS rows (so re-saving doesn't duplicate) but preserves 'learned'
 * facts. Best-effort: logs + returns on a missing table.
 */
export async function seedMemoryFromProfile(
  db: SupabaseClient,
  profile: BusinessProfile,
  projectId: string = DEFAULT_PROJECT,
): Promise<void> {
  const facts = seedFactsFromProfile(profile)
  const del = await db
    .from('business_memory')
    .delete()
    .eq('project_id', projectId)
    .in('kind', PROFILE_KINDS)
  if (del.error) {
    console.warn('[memory] seed delete failed:', del.error.message)
    return
  }
  if (facts.length === 0) return
  const rows = facts.map((f) => ({
    project_id: projectId,
    kind: f.kind,
    fact: f.fact,
    weight: f.weight,
  }))
  const ins = await db.from('business_memory').insert(rows)
  if (ins.error) console.warn('[memory] seed insert failed:', ins.error.message)
}

/** Append a learned fact (enrichment from Act/Learn). Best-effort. */
export async function addLearnedFact(
  db: SupabaseClient,
  fact: string,
  weight = 1,
  projectId: string = DEFAULT_PROJECT,
): Promise<void> {
  const f = fact.trim()
  if (!f) return
  const { error } = await db
    .from('business_memory')
    .insert({ project_id: projectId, kind: 'learned', fact: f.slice(0, 500), weight })
  if (error) console.warn('[memory] addLearnedFact failed:', error.message)
}
