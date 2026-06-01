// Projects — one workspace per idea (its own sources, memory, leads). Pure
// module: types + id/name helpers, no Supabase. The active project is carried
// in a cookie (see lib/project-server.ts) and scopes the project_id columns
// across the workspace tables.
import { DEFAULT_PROJECT } from './memory'

/** The workspace that owns all pre-projects data (lazy-backfilled rows). */
export const DEFAULT_PROJECT_ID = DEFAULT_PROJECT // 'default'

export type Project = {
  id: string
  name: string
  niche: string
  createdAt: number
}

export const DEFAULT_PROJECT_RECORD: Project = {
  id: DEFAULT_PROJECT_ID,
  name: 'Default workspace',
  niche: '',
  createdAt: 0,
}

const SLUG_MAX = 40

/** Turn a display name into a url-safe id stem. Never empty. */
export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, '')
  return base || 'project'
}

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

export function isValidProjectId(id: unknown): id is string {
  return typeof id === 'string' && ID_RE.test(id)
}

export function normalizeProjectName(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ').slice(0, 80) : ''
}

export function normalizeNiche(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ').slice(0, 160) : ''
}
