import type { NextRequest } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { materializeOpportunities } from '@/lib/advantage-materialize'
import { normalizeWeights } from '@/lib/advantage'

// POST /api/opportunities/refresh — recompute + materialize Advantage Scores.
// Body: { weights? } to tune the component weights for this project.
export async function POST(req: NextRequest) {
  let body: unknown = {}
  try {
    body = (await req.json()) ?? {}
  } catch {
    body = {}
  }
  const b = body as { weights?: unknown }
  const weights = b.weights ? normalizeWeights(b.weights) : undefined

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
    const opportunities = await materializeOpportunities(db, { weights })
    return Response.json({ count: opportunities.length, opportunities })
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
