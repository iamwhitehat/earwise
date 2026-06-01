import type { NextRequest } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { normalizeLeadInput, mapLeadRow, type NormalizedLead } from '@/lib/leads'
import { logLeadEvent, LEADS_MIGRATION_HINT, LEAD_COLUMNS } from '@/lib/leads-db'
import { activeProjectId } from '@/lib/project-server'

const MAX_BULK = 100

// POST /api/leads/bulk  — add many leads at once (powers "add top N high-intent
// signals"). Body: { signals: SignalRow[] }. Invalid rows are skipped, not
// fatal. Idempotent: existing (source, external_id) rows are left untouched.
export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const raw = (body ?? {}) as { signals?: unknown }
  const arr = Array.isArray(raw.signals) ? raw.signals : null
  if (!arr) {
    return Response.json({ error: 'Body must be { signals: [...] }' }, { status: 400 })
  }
  if (arr.length === 0) {
    return Response.json({ added: 0, skipped: 0, invalid: 0 })
  }
  if (arr.length > MAX_BULK) {
    return Response.json({ error: `Too many signals (max ${MAX_BULK})` }, { status: 400 })
  }

  // Normalize + de-dupe within the batch by external_id (a list can contain
  // the same signal twice; the unique index would also catch it, but trimming
  // here keeps the insert tidy).
  const seen = new Set<string>()
  const rows: NormalizedLead[] = []
  let invalid = 0
  for (const item of arr) {
    const norm = normalizeLeadInput(item)
    if (!norm.ok) {
      invalid++
      continue
    }
    if (seen.has(norm.lead.external_id)) continue
    seen.add(norm.lead.external_id)
    rows.push(norm.lead)
  }

  if (rows.length === 0) {
    return Response.json({ added: 0, skipped: 0, invalid })
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
  const taggedRows = rows.map((r) => ({ ...r, project_id: projectId }))
  const { data: inserted, error } = await db
    .from('leads')
    .upsert(taggedRows, { onConflict: 'source,external_id', ignoreDuplicates: true })
    .select(LEAD_COLUMNS)

  if (error) {
    console.error('[leads] bulk insert error:', error)
    return Response.json(
      { error: `Database insert failed: ${error.message}. ${LEADS_MIGRATION_HINT}` },
      { status: 500 }
    )
  }

  const insertedRows = inserted ?? []
  for (const r of insertedRows) {
    const lead = mapLeadRow(r)
    await logLeadEvent(db, lead.id, 'created', { external_id: lead.externalId, via: 'bulk' })
  }

  return Response.json({
    added: insertedRows.length,
    skipped: rows.length - insertedRows.length, // already in pipeline
    invalid,
  })
}
