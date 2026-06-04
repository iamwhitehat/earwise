// Server-side access to the founder's voice samples. Kept out of lib/voice.ts
// so that module stays pure/testable (no 'server-only', no Supabase).
import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_PROJECT_ID } from './projects'

export const VOICE_MIGRATION_HINT =
  'If the message names a missing table, run the voice_samples migration in MIGRATIONS.sql.'

// A founder pastes a handful; cap so one bad paste can't blow up the prompt.
export const MAX_VOICE_SAMPLES = 5
export const MAX_SAMPLE_CHARS = 1200

/** Load a project's voice samples, newest first. Tolerant: [] if the table is
 *  absent so opener/reply generation still works without it. */
export async function loadVoiceSamples(
  db: SupabaseClient,
  projectId: string = DEFAULT_PROJECT_ID,
  limit = MAX_VOICE_SAMPLES,
): Promise<string[]> {
  try {
    const { data, error } = await db
      .from('voice_samples')
      .select('body')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error || !data) return []
    return data
      .map((r) => (typeof r.body === 'string' ? r.body.trim() : ''))
      .filter(Boolean)
  } catch {
    return []
  }
}

/** Normalize a raw list of pasted replies: trim, drop blanks, cap count + size,
 *  de-dupe. Pure so the route can validate before touching the DB. */
export function normalizeVoiceSamples(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of list) {
    if (typeof item !== 'string') continue
    const body = item.trim().slice(0, MAX_SAMPLE_CHARS)
    if (!body || seen.has(body)) continue
    seen.add(body)
    out.push(body)
    if (out.length >= MAX_VOICE_SAMPLES) break
  }
  return out
}

/** Replace the project's voice samples with the given set (delete + insert).
 *  Returns the saved list, or throws with a DB error message. */
export async function replaceVoiceSamples(
  db: SupabaseClient,
  samples: string[],
  projectId: string = DEFAULT_PROJECT_ID,
): Promise<string[]> {
  const del = await db.from('voice_samples').delete().eq('project_id', projectId)
  if (del.error) throw new Error(del.error.message)

  if (samples.length === 0) return []

  const rows = samples.map((body) => ({ project_id: projectId, body }))
  const ins = await db.from('voice_samples').insert(rows)
  if (ins.error) throw new Error(ins.error.message)

  return samples
}
