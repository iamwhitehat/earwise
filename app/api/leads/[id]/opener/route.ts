import type { NextRequest } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { draftOpener } from '@/lib/claude'
import { mapLeadRow } from '@/lib/leads'
import {
  logLeadEvent,
  topBuyerPhrases,
  LEADS_MIGRATION_HINT,
  LEAD_COLUMNS,
} from '@/lib/leads-db'
import { logEvent } from '@/lib/events-db'

const VALUEPROP_MAX = 280

function parseId(raw: string): number | null {
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : null
}

// POST /api/leads/[id]/opener
//   body { action: 'generate' (default), valueProp? }  -> generate + persist
//   body { action: 'mark-sent' }                       -> log opener_sent
export async function POST(req: NextRequest, ctx: RouteContext<'/api/leads/[id]/opener'>) {
  const { id } = await ctx.params
  const leadId = parseId(id)
  if (leadId === null) return Response.json({ error: 'Invalid lead id' }, { status: 400 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    body = {}
  }
  const b = (body ?? {}) as { action?: unknown; valueProp?: unknown }
  const action = b.action === 'mark-sent' ? 'mark-sent' : 'generate'

  let db
  try {
    db = getSupabase()
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Configuration error' },
      { status: 500 }
    )
  }

  const { data: row, error: loadErr } = await db
    .from('leads')
    .select(LEAD_COLUMNS)
    .eq('id', leadId)
    .maybeSingle()

  if (loadErr) {
    console.error('[leads] opener load error:', loadErr)
    return Response.json(
      { error: `Database query failed: ${loadErr.message}. ${LEADS_MIGRATION_HINT}` },
      { status: 500 }
    )
  }
  if (!row) return Response.json({ error: 'Lead not found' }, { status: 404 })
  const lead = mapLeadRow(row)

  const nowIso = new Date().toISOString()

  if (action === 'mark-sent') {
    const { data: updated, error: updErr } = await db
      .from('leads')
      .update({ last_event_at: nowIso })
      .eq('id', leadId)
      .select(LEAD_COLUMNS)
      .maybeSingle()
    if (updErr) {
      console.error('[leads] mark-sent error:', updErr)
      return Response.json({ error: `Database update failed: ${updErr.message}` }, { status: 500 })
    }
    await logLeadEvent(db, leadId, 'opener_sent')
    // LEARN: a sent draft, tagged with its angle, anchors the conversion funnel.
    await logEvent(db, {
      entity: 'lead',
      entityId: String(leadId),
      kind: 'draft_sent',
      payload: { intentType: lead.intentType, topic: lead.topic, subreddit: lead.subreddit },
    })
    return Response.json({ lead: mapLeadRow((updated ?? row)) })
  }

  // Generate. Mirror the most recent run's top buyer-language phrases when
  // available; pass an optional valueProp for context only.
  const valueProp =
    typeof b.valueProp === 'string' && b.valueProp.trim()
      ? b.valueProp.trim().slice(0, VALUEPROP_MAX)
      : null
  const phrases = await topBuyerPhrases(db)

  const opener = await draftOpener({
    author: lead.author,
    subreddit: lead.subreddit,
    excerpt: lead.excerpt,
    topic: lead.topic,
    intentType: lead.intentType,
    valueProp,
    phrases,
  })

  if (!opener) {
    return Response.json({ error: 'Claude returned no opener. Try again.' }, { status: 502 })
  }

  const { data: updated, error: persistErr } = await db
    .from('leads')
    .update({ opener_draft: opener, last_event_at: nowIso })
    .eq('id', leadId)
    .select(LEAD_COLUMNS)
    .maybeSingle()

  if (persistErr) {
    console.error('[leads] opener persist error:', persistErr)
    return Response.json({ error: `Database update failed: ${persistErr.message}` }, { status: 500 })
  }

  await logLeadEvent(db, leadId, 'opener_generated')

  return Response.json({
    opener,
    lead: mapLeadRow((updated ?? row)),
  })
}
