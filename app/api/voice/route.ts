import { getSupabase } from '@/lib/supabase'
import { activeProjectId } from '@/lib/project-server'
import { loadVoiceBrief } from '@/lib/voice-brief-db'

// GET /api/voice — the latest distilled Voice brief for the active project, or
// null when none has been generated yet. Pure read, no Claude.
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

  const stored = await loadVoiceBrief(db, await activeProjectId())
  return Response.json(stored ?? null)
}
