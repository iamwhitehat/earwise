import { getSupabase } from '@/lib/supabase'

// GET /api/insights — returns the most recent knowledge_insights row, or
// null if no run has ever been triggered. Pure read, no Claude.

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

  const { data, error } = await db
    .from('knowledge_insights')
    .select('id, insights, stats, generated_at')
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[supabase] insights select error:', error)
    return Response.json(
      { error: 'Database query failed — confirm the knowledge_insights table exists. See SETUP.md (2b-sexies).' },
      { status: 500 }
    )
  }

  if (!data) return Response.json(null)
  return Response.json({
    id: data.id,
    insights: data.insights,
    stats: data.stats,
    generatedAt: new Date(data.generated_at as string).getTime(),
  })
}
