// Server-side persistence for the Voice engine's distilled brief. Kept out of
// lib/voice-brief.ts so that module stays pure/testable (no 'server-only').
import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_PROJECT_ID } from './projects'
import type { VoiceBrief } from './voice-brief'

export const VOICE_BRIEF_MIGRATION_HINT =
  'If the message names a missing table, run the voice_brief migration in MIGRATIONS.sql.'

export type StoredVoiceBrief = { brief: VoiceBrief; model: string; generatedAt: number }

/** Latest brief for a project, or null (tolerant of an unmigrated table). */
export async function loadVoiceBrief(
  db: SupabaseClient,
  projectId: string = DEFAULT_PROJECT_ID,
): Promise<StoredVoiceBrief | null> {
  try {
    const { data, error } = await db
      .from('voice_brief')
      .select('brief, model, generated_at')
      .eq('project_id', projectId)
      .order('generated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error || !data) return null
    return {
      brief: data.brief as VoiceBrief,
      model: (data.model as string) ?? '',
      generatedAt: new Date(data.generated_at as string).getTime(),
    }
  } catch {
    return null
  }
}

/** Persist a new brief (append-only history). Returns its generatedAt epoch ms;
 *  throws with the DB error message so the route can surface it. */
export async function saveVoiceBrief(
  db: SupabaseClient,
  brief: VoiceBrief,
  model: string,
  projectId: string = DEFAULT_PROJECT_ID,
): Promise<number> {
  const { data, error } = await db
    .from('voice_brief')
    .insert({ project_id: projectId, brief, model })
    .select('generated_at')
    .single()
  if (error || !data) throw new Error(error?.message ?? 'insert failed')
  return new Date(data.generated_at as string).getTime()
}
