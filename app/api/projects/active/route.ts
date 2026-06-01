import type { NextRequest } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { getProject } from '@/lib/projects-db'
import { activeProjectId, setActiveProjectId } from '@/lib/project-server'
import { isValidProjectId, DEFAULT_PROJECT_ID } from '@/lib/projects'

// GET /api/projects/active — the active workspace id.
export async function GET() {
  return Response.json({ active: await activeProjectId() })
}

// POST /api/projects/active — switch the active workspace. Body: { projectId }
export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const projectId = (body as { projectId?: unknown })?.projectId
  if (!isValidProjectId(projectId)) {
    return Response.json({ error: 'Invalid projectId' }, { status: 400 })
  }

  // The default workspace always exists; others must be present in the table.
  if (projectId !== DEFAULT_PROJECT_ID) {
    let db
    try {
      db = getSupabase()
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : 'Configuration error' },
        { status: 500 }
      )
    }
    const project = await getProject(db, projectId)
    if (!project) return Response.json({ error: 'Unknown project' }, { status: 404 })
  }

  await setActiveProjectId(projectId)
  return Response.json({ active: projectId })
}
