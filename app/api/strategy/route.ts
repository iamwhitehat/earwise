import { getSupabase } from '@/lib/supabase'

// GET /api/strategy — the most recent strategy run, or null if none yet.
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
    .from('strategy_runs')
    .select('id, brief, model, prompt_version, inputs_hash, created_at')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[strategy] latest read error:', error)
    return Response.json(
      {
        error: `Database query failed: ${error.message}. ` +
          'If a missing table is named, run the Guided strategist migration in SETUP.md (2b-terdecies).',
      },
      { status: 500 }
    )
  }

  if (!data) return Response.json(null)
  return Response.json({
    id: data.id,
    brief: data.brief,
    model: data.model,
    promptVersion: data.prompt_version,
    inputsHash: data.inputs_hash,
    generatedAt: new Date(data.created_at as string).getTime(),
  })
}
