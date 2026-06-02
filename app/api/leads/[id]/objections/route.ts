import type { NextRequest } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { loadLeadById } from '@/lib/leads-db'
import { addMessage } from '@/lib/lead-messages-db'
import { loadSignals } from '@/lib/signals-db'
import { buildObjectionLibrary } from '@/lib/objections'
import { draftObjectionResponse } from '@/lib/claude'
import { loadMemoryFacts } from '@/lib/memory-db'
import { offerText } from '@/lib/memory'
import { logEvent } from '@/lib/events-db'
import { activeProjectId } from '@/lib/project-server'

const OBJECTION_MAX = 300

function parseId(raw: string): number | null {
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : null
}

// GET /api/leads/[id]/objections — the objection→response library for this
// lead's market: people switching away from incumbents in the same subreddit
// are voicing the objections you'll hear. Tolerant: empty on any error.
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
  const projectId = await activeProjectId()

  const lead = await loadLeadById(db, leadId, projectId)
  if (!lead) return Response.json({ error: 'Lead not found' }, { status: 404 })

  try {
    const signals = await loadSignals(db, { intent: 'switching', sub: lead.subreddit, ageMs: null })
    const objections = buildObjectionLibrary(
      signals.map((s) => ({ text: s.text.slice(0, 200), type: 'switching' })),
    )
    return Response.json({ objections })
  } catch (err) {
    console.warn('[objections] library failed:', err)
    return Response.json({ objections: [] })
  }
}

// POST /api/leads/[id]/objections — draft a tailored response to a specific
// objection and add it to the thread as an unsent outbound draft.
// Body: { objection }
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
  const objection = typeof (body as { objection?: unknown })?.objection === 'string'
    ? ((body as { objection: string }).objection).trim().slice(0, OBJECTION_MAX)
    : ''
  if (!objection) return Response.json({ error: 'Missing objection' }, { status: 400 })

  let db
  try {
    db = getSupabase()
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Configuration error' }, { status: 500 })
  }
  const projectId = await activeProjectId()

  const lead = await loadLeadById(db, leadId, projectId)
  if (!lead) return Response.json({ error: 'Lead not found' }, { status: 404 })

  const memFacts = await loadMemoryFacts(db, projectId)
  const draft = await draftObjectionResponse({
    subreddit: lead.subreddit,
    author: lead.author,
    objection,
    theirPost: lead.excerpt,
    offer: offerText(memFacts) || null,
  })
  if (!draft) return Response.json({ error: 'Claude returned no response. Try again.' }, { status: 502 })

  const message = await addMessage(db, { leadId, role: 'outbound', kind: 'objection_response', body: draft, sent: false })
  await logEvent(db, { entity: 'lead', entityId: String(leadId), kind: 'objection_drafted', payload: { objection }, projectId })

  return Response.json({ message, objection })
}
