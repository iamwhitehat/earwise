import type { NextRequest } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { listProjects, createProject, ensureDefaultProject } from '@/lib/projects-db'
import { activeProjectId, setActiveProjectId } from '@/lib/project-server'
import { normalizeProjectName } from '@/lib/projects'

const MIGRATION_HINT =
  'If a missing table is named, run the Projects migration in SETUP.md (2b-duodevicies).'

// GET /api/projects — list workspaces + the active one.
export async function GET() {
  let db
  try {
    db = getSupabase()
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Configuration error' },
      { status: 500 }
    )
  }

  const [projects, active] = await Promise.all([listProjects(db), activeProjectId()])
  return Response.json({ projects, active })
}

// POST /api/projects — create a workspace and make it active.
// Body: { name, niche? }
export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const b = (body ?? {}) as { name?: unknown; niche?: unknown }
  const name = normalizeProjectName(b.name)
  if (!name) return Response.json({ error: 'A project name is required' }, { status: 400 })

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
    await ensureDefaultProject(db)
    const project = await createProject(db, { name, niche: typeof b.niche === 'string' ? b.niche : '' })
    await setActiveProjectId(project.id)
    return Response.json({ project }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Create failed'
    console.error('[projects] create error:', err)
    return Response.json({ error: `${message}. ${MIGRATION_HINT}` }, { status: 500 })
  }
}
