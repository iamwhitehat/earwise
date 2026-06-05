import type { NextRequest } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { gateUsage } from '@/lib/usage-credits-db'
import { loadLeadById } from '@/lib/leads-db'
import { loadMessages, addMessage } from '@/lib/lead-messages-db'
import { draftFollowUp } from '@/lib/claude'
import { loadMemoryFacts } from '@/lib/memory-db'
import { offerText } from '@/lib/memory'
import { nextFollowUpAt, nextSequenceStep } from '@/lib/follow-ups'
import { logEvent } from '@/lib/events-db'
import { activeProjectId } from '@/lib/project-server'

function parseId(raw: string): number | null {
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : null
}

// POST /api/leads/[id]/follow-up — draft the next follow-up nudge (grounded in
// their post + the thread + your offer), add it as an unsent outbound draft, and
// schedule the next reminder (+3d) / advance the sequence cursor. Founder still
// approves + marks sent — nothing is auto-sent.
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
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

  // Usage-credit gate (margin guard) — Haiku draft.
  const over = await gateUsage(db, projectId, 'draft')
  if (over) return over

  const [messages, memFacts] = await Promise.all([
    loadMessages(db, leadId),
    loadMemoryFacts(db, projectId),
  ])

  const draft = await draftFollowUp({
    subreddit: lead.subreddit,
    author: lead.author,
    theirPost: lead.excerpt,
    priorMessages: messages.map((m) => ({ role: m.role, body: m.body })),
    offer: offerText(memFacts) || null,
  })
  if (!draft) return Response.json({ error: 'Claude returned no follow-up. Try again.' }, { status: 502 })

  const message = await addMessage(db, { leadId, role: 'outbound', kind: 'follow_up', body: draft, sent: false })

  // Schedule the next reminder + advance the sequence (best-effort — tolerant of
  // the columns being unmigrated). Drafting commits the cadence so the lead
  // leaves the "Needs follow-up" queue instead of re-drafting on every load.
  const patch = {
    next_follow_up_at: new Date(nextFollowUpAt()).toISOString(),
    sequence_step: nextSequenceStep(lead.sequenceStep),
    last_event_at: new Date().toISOString(),
  }
  const upd = await db.from('leads').update(patch).eq('id', leadId).eq('project_id', projectId)
  if (upd.error) console.warn('[follow-up] schedule skipped:', upd.error.message)

  await logEvent(db, { entity: 'lead', entityId: String(leadId), kind: 'follow_up_drafted', payload: { sequenceStep: patch.sequence_step }, projectId })

  const updated = await loadLeadById(db, leadId, projectId)
  return Response.json({ message, lead: updated ?? lead })
}
