import type { NextRequest } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { synthesizeKnowledgeInsights, resolveSynthModel } from '@/lib/claude'
import { aggregateInsights, renderAggregatedForClaude } from '@/lib/insights-aggregator'

// POST /api/insights/refresh — runs the cross-signal aggregation, calls
// Claude to synthesize insights, INSERTs a new row into knowledge_insights,
// and returns the new payload. Cost: one Claude Haiku call (~$0.01–0.02).
// Triggered only by the user via the Refresh button on /insights.

export async function POST(req: NextRequest) {
  // Optional { tier } chooses the synthesis model (Fast/Balanced/Max); the
  // resolver falls back to Balanced for a missing/invalid value.
  let tier: unknown
  try {
    tier = (await req.json())?.tier
  } catch {
    tier = undefined
  }
  const model = resolveSynthModel(tier)

  let db
  try {
    db = getSupabase()
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Configuration error' },
      { status: 500 }
    )
  }

  let aggregated
  try {
    aggregated = await aggregateInsights(db)
  } catch (err) {
    console.error('[insights] aggregation failed:', err)
    return Response.json(
      { error: err instanceof Error ? err.message : 'Aggregation failed' },
      { status: 500 }
    )
  }

  if (aggregated.postCount === 0) {
    return Response.json(
      { error: 'No classified posts yet — scan some subreddits first.' },
      { status: 400 }
    )
  }

  const rendered = renderAggregatedForClaude(aggregated)
  const insights = await synthesizeKnowledgeInsights(rendered, model)

  if (insights.length === 0) {
    return Response.json(
      { error: 'Claude returned no insights. Try again or scan more posts first.' },
      { status: 502 }
    )
  }

  // Snapshot of the data we fed in — for the "from N posts and M deep scans"
  // line in the UI. Top topics included for context (not for display).
  const stats = {
    postCount: aggregated.postCount,
    deepScanCount: aggregated.deepScanCount,
    topTopics: aggregated.topTopics.slice(0, 10),
  }

  const { data, error } = await db
    .from('knowledge_insights')
    .insert({ insights, stats })
    .select('id, generated_at')
    .single()

  if (error || !data) {
    console.error('[supabase] knowledge_insights insert error:', error)
    return Response.json(
      { error: 'Database insert failed — confirm the knowledge_insights table exists. See SETUP.md (2b-sexies).' },
      { status: 500 }
    )
  }

  return Response.json({
    id: data.id,
    insights,
    stats,
    generatedAt: new Date(data.generated_at as string).getTime(),
  })
}
