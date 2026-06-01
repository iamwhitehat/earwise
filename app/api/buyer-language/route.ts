import { getSupabase } from '@/lib/supabase'

// GET /api/buyer-language — returns the most recent buyer_language row, or
// null if nothing has been generated. Pure read, no Claude.

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

  // Try selecting `messaging` (Phase 2); fall back to the legacy column set if
  // that column hasn't been migrated yet.
  const COLS_V2 = 'id, phrases, tools, emotional, messaging, stats, generated_at'
  const COLS_V1 = 'id, phrases, tools, emotional, stats, generated_at'
  let res = await db
    .from('buyer_language')
    .select(COLS_V2)
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (res.error && /messaging/.test(res.error.message)) {
    res = await db
      .from('buyer_language')
      .select(COLS_V1)
      .order('generated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
  }

  const { data, error } = res
  if (error) {
    console.error('[supabase] buyer_language read error:', error)
    return Response.json(
      {
        error: `Database query failed: ${error.message}. ` +
          `Confirm migration 2b-octies has run (see SETUP.md).`,
      },
      { status: 500 }
    )
  }

  if (!data) return Response.json(null)
  const row = data as Record<string, unknown>
  return Response.json({
    id: row.id,
    phrases: row.phrases,
    tools: row.tools,
    emotional: row.emotional,
    messaging: row.messaging ?? null,
    stats: row.stats,
    generatedAt: new Date(row.generated_at as string).getTime(),
  })
}
