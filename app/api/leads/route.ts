import type { NextRequest } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import {
  isValidStatus,
  normalizeLeadInput,
  mapLeadRow,
  emptyStatusCounts,
  type LeadStatus,
} from '@/lib/leads'
import { logLeadEvent, LEADS_MIGRATION_HINT, LEAD_COLUMNS } from '@/lib/leads-db'
import { scoreLeads, sortHotFirst } from '@/lib/leads-score-db'
import { activeProjectId } from '@/lib/project-server'
import { qualifySignal } from '@/lib/gate-db'
import type { SignalRow } from '@/lib/signals-db'
import type { IntentType } from '@/lib/intent-patterns'
import type { Category } from '@/lib/categories'

// GET /api/leads?status=  — list leads (newest activity first) + per-status
// counts. Status filter is optional; an unknown status is a 400.
export async function GET(req: NextRequest) {
  const statusParam = new URL(req.url).searchParams.get('status')
  if (statusParam && !isValidStatus(statusParam)) {
    return Response.json({ error: `Invalid status: ${statusParam}` }, { status: 400 })
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

  const projectId = await activeProjectId()

  // Default board hides disqualified (off-niche / non-buyer) leads. The filter
  // is applied at the DB but degrades gracefully: if the column isn't migrated
  // yet the query errors, and we retry without it (nothing hidden).
  const listLeads = (excludeDisq: boolean) => {
    let q = db
      .from('leads')
      .select(LEAD_COLUMNS)
      .eq('project_id', projectId)
      .order('last_event_at', { ascending: false })
      .limit(500)
    if (statusParam) q = q.eq('status', statusParam)
    if (excludeDisq) q = q.eq('disqualified', false)
    return q
  }
  const countLeads = (excludeDisq: boolean) => {
    let q = db.from('leads').select('status').eq('project_id', projectId)
    if (excludeDisq) q = q.eq('disqualified', false)
    return q
  }

  let [listRes, countRes] = await Promise.all([listLeads(true), countLeads(true)])
  // Retry without the disqualified filter if the column is absent.
  if (listRes.error) listRes = await listLeads(false)
  if (countRes.error) countRes = await countLeads(false)

  if (listRes.error || countRes.error) {
    const err = listRes.error ?? countRes.error
    console.error('[leads] list query error:', err)
    return Response.json(
      { error: `Database query failed: ${err?.message}. ${LEADS_MIGRATION_HINT}` },
      { status: 500 }
    )
  }

  const counts = emptyStatusCounts()
  for (const row of countRes.data ?? []) {
    const s = row.status
    if (isValidStatus(s)) counts[s]++
  }

  // Score each lead fresh (authoritative), lazily backfill stored scores, and
  // sort hot-first by default — the Convert "Hot first" board.
  const scored = await scoreLeads(db, (listRes.data ?? []).map((r) => mapLeadRow(r)), projectId)
  const leads = sortHotFirst(scored)
  const total = (countRes.data ?? []).length

  return Response.json({ leads, counts, total })
}

// POST /api/leads  — create a lead from a SignalRow. Idempotent on
// (source, external_id): a second POST for the same signal returns the
// existing lead with created:false and logs nothing.
export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const norm = normalizeLeadInput(body)
  if (!norm.ok) {
    return Response.json({ error: norm.error }, { status: 400 })
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

  const projectId = await activeProjectId()

  // Combined relevance + buyer-intent gate: off-niche posts and makers/
  // self-promoters never reach the leads table. Degrades open — when
  // classification/embeddings are unavailable the candidate passes, so only a
  // confident disqualification blocks a save.
  const id = norm.lead.external_id.slice(norm.lead.kind.length + 1)
  const sigForGate: SignalRow = {
    kind: norm.lead.kind,
    id,
    post_id: norm.lead.post_id,
    subreddit: norm.lead.subreddit,
    author: norm.lead.author,
    text: norm.lead.excerpt,
    matchedPhrase: '',
    intentType: (norm.lead.intent_type as IntentType) ?? 'looking-for',
    category: (norm.lead.category as Category) ?? 'other',
    topic: norm.lead.topic,
    analyzedAt: Date.now(),
    permalink: norm.lead.permalink,
  }
  const gate = await qualifySignal(db, sigForGate, projectId)
  if (!gate.ok) {
    return Response.json(
      { error: `This lead was filtered out as ${gate.reason}.`, disqualified: true, reason: gate.reason },
      { status: 422 },
    )
  }

  // Insert, ignoring a conflict on the unique (source, external_id) key. A
  // returned row means it was newly created; an empty result means it already
  // existed, which we then fetch so the client always gets the lead back. The
  // lead is tagged with the active project (workspace).
  const { data: inserted, error: insertErr } = await db
    .from('leads')
    .upsert({ ...norm.lead, project_id: projectId }, { onConflict: 'source,external_id', ignoreDuplicates: true })
    .select(LEAD_COLUMNS)
    .maybeSingle()

  if (insertErr) {
    console.error('[leads] insert error:', insertErr)
    return Response.json(
      { error: `Database insert failed: ${insertErr.message}. ${LEADS_MIGRATION_HINT}` },
      { status: 500 }
    )
  }

  if (inserted) {
    const lead = mapLeadRow(inserted)
    await logLeadEvent(db, lead.id, 'created', { external_id: lead.externalId })
    const [scored] = await scoreLeads(db, [lead], projectId)
    return Response.json({ lead: scored ?? lead, created: true }, { status: 201 })
  }

  // Already in the pipeline — return the existing row.
  const { data: existing, error: fetchErr } = await db
    .from('leads')
    .select(LEAD_COLUMNS)
    .eq('source', norm.lead.source)
    .eq('external_id', norm.lead.external_id)
    .maybeSingle()
  // Note: the (source, external_id) uniqueness is global in v1, so a signal
  // already saved in another workspace returns that row here.

  if (fetchErr || !existing) {
    return Response.json(
      { error: `Lead exists but could not be loaded: ${fetchErr?.message ?? 'not found'}` },
      { status: 500 }
    )
  }

  const [scoredExisting] = await scoreLeads(db, [mapLeadRow(existing)], projectId)
  return Response.json({ lead: scoredExisting ?? mapLeadRow(existing), created: false })
}

export type { LeadStatus }
