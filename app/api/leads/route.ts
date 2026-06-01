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
import { activeProjectId } from '@/lib/project-server'

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
  let listQuery = db
    .from('leads')
    .select(LEAD_COLUMNS)
    .eq('project_id', projectId)
    .order('last_event_at', { ascending: false })
    .limit(500)
  if (statusParam) listQuery = listQuery.eq('status', statusParam)

  // Counts come from a separate lightweight read of every lead's status so the
  // board can show per-column totals regardless of the active filter.
  const [listRes, countRes] = await Promise.all([
    listQuery,
    db.from('leads').select('status').eq('project_id', projectId),
  ])

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

  const leads = (listRes.data ?? []).map((r) => mapLeadRow(r))
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

  // Insert, ignoring a conflict on the unique (source, external_id) key. A
  // returned row means it was newly created; an empty result means it already
  // existed, which we then fetch so the client always gets the lead back. The
  // lead is tagged with the active project (workspace).
  const projectId = await activeProjectId()
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
    return Response.json({ lead, created: true }, { status: 201 })
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

  return Response.json({ lead: mapLeadRow(existing), created: false })
}

export type { LeadStatus }
