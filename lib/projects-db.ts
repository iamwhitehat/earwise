// Server-side Projects access. Tolerant of an unmigrated `projects` table:
// reads degrade to a synthetic default workspace so the app still works.
import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  DEFAULT_PROJECT_ID,
  DEFAULT_PROJECT_RECORD,
  slugify,
  normalizeProjectName,
  normalizeNiche,
  type Project,
} from './projects'

type Row = { id: string; name: string | null; niche: string | null; created_at: string | null }

function mapRow(r: Row): Project {
  return {
    id: r.id,
    name: r.name ?? r.id,
    niche: r.niche ?? '',
    createdAt: r.created_at ? new Date(r.created_at).getTime() : 0,
  }
}

/** List all projects (default workspace always first). Synthetic default when
 *  the table is absent. */
export async function listProjects(db: SupabaseClient): Promise<Project[]> {
  const { data, error } = await db
    .from('projects')
    .select('id, name, niche, created_at')
    .order('created_at', { ascending: true })
  if (error) {
    console.warn('[projects] list failed:', error.message)
    return [DEFAULT_PROJECT_RECORD]
  }
  const rows = (data ?? []).map(mapRow)
  return rows.some((p) => p.id === DEFAULT_PROJECT_ID)
    ? rows
    : [DEFAULT_PROJECT_RECORD, ...rows]
}

export async function getProject(db: SupabaseClient, id: string): Promise<Project | null> {
  if (id === DEFAULT_PROJECT_ID) return DEFAULT_PROJECT_RECORD
  const { data, error } = await db
    .from('projects')
    .select('id, name, niche, created_at')
    .eq('id', id)
    .maybeSingle()
  if (error || !data) return null
  return mapRow(data as Row)
}

/**
 * Create a project with a unique slug-based id. Retries with a numeric suffix
 * on id collision. Throws on a non-collision DB error so the caller surfaces a
 * migration hint.
 */
export async function createProject(
  db: SupabaseClient,
  input: { name: string; niche?: string },
): Promise<Project> {
  const name = normalizeProjectName(input.name) || 'Untitled'
  const niche = normalizeNiche(input.niche)
  const stem = slugify(name)

  for (let attempt = 0; attempt < 6; attempt++) {
    const id = attempt === 0 ? stem : `${stem}-${attempt + 1}`
    const { data, error } = await db
      .from('projects')
      .insert({ id, name, niche })
      .select('id, name, niche, created_at')
      .maybeSingle()
    if (!error && data) return mapRow(data as Row)
    // 23505 = unique_violation → try the next suffix; anything else is fatal.
    if (error && error.code !== '23505') {
      throw new Error(error.message)
    }
  }
  throw new Error('Could not allocate a unique project id')
}

/** Best-effort: ensure the default workspace row exists (idempotent). */
export async function ensureDefaultProject(db: SupabaseClient): Promise<void> {
  const { error } = await db
    .from('projects')
    .upsert(
      { id: DEFAULT_PROJECT_ID, name: DEFAULT_PROJECT_RECORD.name, niche: '' },
      { onConflict: 'id', ignoreDuplicates: true },
    )
  if (error) console.warn('[projects] ensureDefault failed:', error.message)
}
