import type { NextRequest } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { activeProjectId } from '@/lib/project-server'
import {
  loadVoiceSamples,
  normalizeVoiceSamples,
  replaceVoiceSamples,
  VOICE_MIGRATION_HINT,
} from '@/lib/voice-db'

function db() {
  return getSupabase()
}

// GET /api/voice-samples — the founder's pasted replies for the active project.
export async function GET() {
  let client
  try {
    client = db()
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Configuration error' },
      { status: 500 }
    )
  }

  const samples = await loadVoiceSamples(client, await activeProjectId())
  return Response.json({ samples })
}

// PUT /api/voice-samples — replace the founder's voice samples.
// Body: { samples: string[] }
export async function PUT(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const samples = normalizeVoiceSamples((body as { samples?: unknown })?.samples)

  let client
  try {
    client = db()
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Configuration error' },
      { status: 500 }
    )
  }

  try {
    const saved = await replaceVoiceSamples(client, samples, await activeProjectId())
    return Response.json({ samples: saved })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    console.error('[voice-samples] save error:', message)
    return Response.json(
      { error: `Database write failed: ${message}. ${VOICE_MIGRATION_HINT}` },
      { status: 500 }
    )
  }
}
