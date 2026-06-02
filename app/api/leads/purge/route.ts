import { getSupabase } from '@/lib/supabase'
import { mapLeadRow } from '@/lib/leads'
import { LEAD_COLUMNS, LEADS_MIGRATION_HINT, disqualifyLead } from '@/lib/leads-db'
import { leadToSignal } from '@/lib/leads-score-db'
import { qualifySignal } from '@/lib/gate-db'
import { activeProjectId } from '@/lib/project-server'

// How many leads to re-evaluate per run, so the one-off pass stays bounded.
const PURGE_CAP = 200

// POST /api/leads/purge — one-off de-noise: re-run every active lead in the
// current project through the combined relevance + buyer-intent gate and flag
// the off-niche / non-buyer ones as disqualified (so the socks/conference-room/
// RHYMEBOOK rows drop out of the board) without deleting them. Idempotent:
// already-disqualified leads are skipped.
export async function POST() {
  let db
  try {
    db = getSupabase()
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Configuration error' },
      { status: 500 },
    )
  }

  const projectId = await activeProjectId()
  const { data, error } = await db
    .from('leads')
    .select(LEAD_COLUMNS)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1000)
  if (error) {
    return Response.json(
      { error: `Database query failed: ${error.message}. ${LEADS_MIGRATION_HINT}` },
      { status: 500 },
    )
  }

  const leads = (data ?? []).map(mapLeadRow).filter((l) => !l.disqualified).slice(0, PURGE_CAP)
  let disqualified = 0
  const reasons: { id: number; reason: string }[] = []
  for (const lead of leads) {
    const gate = await qualifySignal(db, leadToSignal(lead), projectId)
    if (gate.ok) continue
    if (await disqualifyLead(db, lead.id, gate.reason)) {
      disqualified++
      reasons.push({ id: lead.id, reason: gate.reason })
    }
  }

  return Response.json({ checked: leads.length, disqualified, reasons })
}
