import type { NextRequest } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { materializeOpportunities } from '@/lib/advantage-materialize'
import { normalizeWeights } from '@/lib/advantage'
import { loadRecalibration } from '@/lib/recalibrate-db'
import { activeProjectId } from '@/lib/project-server'

// POST /api/opportunities/refresh — recompute + materialize Advantage Scores.
// Body: { weights? } to override the component weights for this project; when
// omitted, weights are recalibrated from realized pursue/park outcomes (LEARN).
export async function POST(req: NextRequest) {
  let body: unknown = {}
  try {
    body = (await req.json()) ?? {}
  } catch {
    body = {}
  }
  const b = body as { weights?: unknown }

  let db
  try {
    db = getSupabase()
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Configuration error' },
      { status: 500 }
    )
  }

  try {
    const projectId = await activeProjectId()
    const recal = b.weights ? null : await loadRecalibration(db, projectId)
    const weights = b.weights ? normalizeWeights(b.weights) : recal?.weights
    const opportunities = await materializeOpportunities(db, { weights, projectId })
    return Response.json({
      count: opportunities.length,
      opportunities,
      recalibrated: recal?.adjusted ?? false,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Materialization failed'
    console.error('[opportunities/refresh] error:', err)
    return Response.json(
      {
        error: `${message}. If a missing table is named, run the Advantage Score migration in SETUP.md (2b-quindecies).`,
      },
      { status: 500 }
    )
  }
}
