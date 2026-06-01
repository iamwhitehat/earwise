import { getSupabase } from '@/lib/supabase'
import { seedDemoWorkspace } from '@/lib/demo-db'
import { setActiveProjectId } from '@/lib/project-server'
import { DEMO_PROJECT_ID } from '@/lib/demo-data'

const MIGRATION_HINT =
  'If nothing populates, run the Projects migration in SETUP.md (2b-duodevicies) plus the earlier per-table migrations.'

// POST /api/projects/demo — seed the preloaded demo workspace and make it
// active, so a new visitor sees a fully populated app before any setup.
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

  const seeded = await seedDemoWorkspace(db)
  await setActiveProjectId(DEMO_PROJECT_ID)
  return Response.json({ ok: true, seeded, hint: MIGRATION_HINT })
}
