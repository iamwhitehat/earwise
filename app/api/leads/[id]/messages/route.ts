import type { NextRequest } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { loadLeadById } from '@/lib/leads-db'
import { loadMessages, addMessage, markMessageSent } from '@/lib/lead-messages-db'
import { isValidRole, isValidMessageKind } from '@/lib/lead-messages'
import { logEvent } from '@/lib/events-db'
import { activeProjectId } from '@/lib/project-server'

const MIGRATION_HINT =
  'If a missing table is named, run the Convert-core migration in SETUP.md (2b-undevicies).'

function parseId(raw: string): number | null {
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : null
}

// GET /api/leads/[id]/messages — the conversation thread (oldest first).
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const leadId = parseId(id)
  if (leadId === null) return Response.json({ error: 'Invalid lead id' }, { status: 400 })

  let db
  try {
    db = getSupabase()
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Configuration error' }, { status: 500 })
  }

  const messages = await loadMessages(db, leadId)
  return Response.json({ messages })
}

// POST /api/leads/[id]/messages
//   { role, kind, body, sent? }            → add a message (outbound draft / inbound reply)
//   { action: 'mark-sent', messageId }     → mark an outbound draft as sent
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const leadId = parseId(id)
  if (leadId === null) return Response.json({ error: 'Invalid lead id' }, { status: 400 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const b = (body ?? {}) as Record<string, unknown>

  let db
  try {
    db = getSupabase()
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Configuration error' }, { status: 500 })
  }
  const projectId = await activeProjectId()

  if (b.action === 'mark-sent') {
    const messageId = Number(b.messageId)
    if (!Number.isInteger(messageId)) {
      return Response.json({ error: 'Missing messageId' }, { status: 400 })
    }
    const message = await markMessageSent(db, leadId, messageId)
    if (!message) return Response.json({ error: 'Message not found' }, { status: 404 })
    await logEvent(db, { entity: 'lead', entityId: String(leadId), kind: 'msg_outbound', payload: { messageKind: message.kind, sent: true }, projectId })
    return Response.json({ message })
  }

  if (!isValidRole(b.role)) return Response.json({ error: 'Invalid role' }, { status: 400 })
  if (!isValidMessageKind(b.kind)) return Response.json({ error: 'Invalid kind' }, { status: 400 })
  const text = typeof b.body === 'string' ? b.body : ''
  if (!text.trim()) return Response.json({ error: 'Missing body' }, { status: 400 })

  const message = await addMessage(db, {
    leadId,
    role: b.role,
    kind: b.kind,
    body: text,
    sent: b.sent === true,
  })
  if (!message) return Response.json({ error: `Could not add message. ${MIGRATION_HINT}` }, { status: 500 })

  // Record timing in events (non-funnel kinds; inbound also feeds the funnel as a reply).
  await logEvent(db, {
    entity: 'lead',
    entityId: String(leadId),
    kind: message.role === 'inbound' ? 'reply' : 'msg_outbound',
    payload: { messageKind: message.kind },
    projectId,
  })

  // An inbound reply means they engaged — nudge the lead to `replied` if it was
  // still `new`/`contacted`, so the sequence switches to the discovery-call ask.
  if (message.role === 'inbound') {
    const lead = await loadLeadById(db, leadId, projectId)
    if (lead && (lead.status === 'new' || lead.status === 'contacted')) {
      await db.from('leads').update({ status: 'replied', last_event_at: new Date().toISOString() }).eq('id', leadId).eq('project_id', projectId)
    }
  }

  return Response.json({ message }, { status: 201 })
}
