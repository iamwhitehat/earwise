import type { NextRequest } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isValidStatus, mapLeadRow } from '@/lib/leads'
import { logLeadEvent, LEADS_MIGRATION_HINT, LEAD_COLUMNS } from '@/lib/leads-db'

const NOTES_MAX = 4000

function parseId(raw: string): number | null {
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : null
}

// PATCH /api/leads/[id]  — update status and/or notes. Bumps last_event_at and
// logs a status_change event when the status actually moves.
export async function PATCH(req: NextRequest, ctx: RouteContext<'/api/leads/[id]'>) {
  const { id } = await ctx.params
  const leadId = parseId(id)
  if (leadId === null) return Response.json({ error: 'Invalid lead id' }, { status: 400 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const b = (body ?? {}) as { status?: unknown; notes?: unknown }

  const hasStatus = b.status !== undefined
  const hasNotes = b.notes !== undefined
  if (!hasStatus && !hasNotes) {
    return Response.json({ error: 'Nothing to update (provide status and/or notes)' }, { status: 400 })
  }
  if (hasStatus && !isValidStatus(b.status)) {
    return Response.json({ error: `Invalid status: ${String(b.status)}` }, { status: 400 })
  }

  let db
  try {
    db = getSupabase()
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Configuration error' },
      { status: 500 }
    )
  }

  const patch: Record<string, unknown> = { last_event_at: new Date().toISOString() }
  if (hasStatus) patch.status = b.status
  if (hasNotes) {
    const notes = typeof b.notes === 'string' ? b.notes.trim().slice(0, NOTES_MAX) : ''
    patch.notes = notes.length > 0 ? notes : null
  }

  const { data, error } = await db
    .from('leads')
    .update(patch)
    .eq('id', leadId)
    .select(LEAD_COLUMNS)
    .maybeSingle()

  if (error) {
    console.error('[leads] update error:', error)
    return Response.json(
      { error: `Database update failed: ${error.message}. ${LEADS_MIGRATION_HINT}` },
      { status: 500 }
    )
  }
  if (!data) return Response.json({ error: 'Lead not found' }, { status: 404 })

  if (hasStatus) {
    await logLeadEvent(db, leadId, 'status_change', { status: b.status })
  }

  return Response.json({ lead: mapLeadRow(data) })
}

// DELETE /api/leads/[id]  — remove a lead (its events cascade away).
export async function DELETE(_req: NextRequest, ctx: RouteContext<'/api/leads/[id]'>) {
  const { id } = await ctx.params
  const leadId = parseId(id)
  if (leadId === null) return Response.json({ error: 'Invalid lead id' }, { status: 400 })

  let db
  try {
    db = getSupabase()
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Configuration error' },
      { status: 500 }
    )
  }

  const { error } = await db.from('leads').delete().eq('id', leadId)
  if (error) {
    console.error('[leads] delete error:', error)
    return Response.json(
      { error: `Database delete failed: ${error.message}. ${LEADS_MIGRATION_HINT}` },
      { status: 500 }
    )
  }

  return Response.json({ ok: true })
}
