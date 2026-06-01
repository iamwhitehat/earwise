import type { NextRequest } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { logEvent } from '@/lib/events-db'
import { isValidEventKind, type EventEntity } from '@/lib/events'
import { activeProjectId } from '@/lib/project-server'

const ENTITIES: EventEntity[] = ['lead', 'opportunity']
const MAX_ID = 200

// POST /api/events — record an outcome event (LEARN). Used by the UI for
// opportunity pursued/parked; lead outcomes are logged by the lead routes.
// Body: { entity, entityId, kind, payload? }
export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const b = (body ?? {}) as Record<string, unknown>

  const entity = b.entity as EventEntity
  if (!ENTITIES.includes(entity)) {
    return Response.json({ error: "entity must be 'lead' or 'opportunity'" }, { status: 400 })
  }
  const entityId = typeof b.entityId === 'string' ? b.entityId.trim().slice(0, MAX_ID) : ''
  if (!entityId) return Response.json({ error: 'Missing entityId' }, { status: 400 })
  if (!isValidEventKind(b.kind)) {
    return Response.json({ error: `Invalid kind: ${String(b.kind)}` }, { status: 400 })
  }
  const payload =
    b.payload && typeof b.payload === 'object' ? (b.payload as Record<string, unknown>) : undefined

  let db
  try {
    db = getSupabase()
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Configuration error' },
      { status: 500 }
    )
  }

  await logEvent(db, { entity, entityId, kind: b.kind, payload, projectId: await activeProjectId() })
  return Response.json({ ok: true })
}
