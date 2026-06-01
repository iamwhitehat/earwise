import { getSupabase } from '@/lib/supabase'
import { loadEvents } from '@/lib/events-db'
import { activeProjectId } from '@/lib/project-server'
import {
  funnelTotals,
  conversionRates,
  buildOutcomeSamples,
  recalibrateWeights,
} from '@/lib/recalibrate'

const TOP = 5

// GET /api/events/summary — "what's working": lead-funnel totals, top
// converting angles (by intent + topic), and pursue/park recalibration status.
// Tolerant: an unmigrated `events` table yields empty, zeroed results.
export async function GET() {
  let db
  try {
    db = getSupabase()
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Configuration error' },
      { status: 500 }
    )
  }

  const events = await loadEvents(db, { projectId: await activeProjectId() })
  const samples = buildOutcomeSamples(events)
  const recal = recalibrateWeights(samples)

  return Response.json({
    funnel: funnelTotals(events),
    byIntent: conversionRates(events, 'intentType').slice(0, TOP),
    byTopic: conversionRates(events, 'topic').slice(0, TOP),
    opportunities: {
      pursued: samples.filter((s) => s.won).length,
      parked: samples.filter((s) => !s.won).length,
    },
    recalibration: { adjusted: recal.adjusted, samples: recal.sampleCount, weights: recal.weights },
  })
}
