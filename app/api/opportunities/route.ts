import { getSupabase } from '@/lib/supabase'
import { DEFAULT_PROJECT } from '@/lib/memory'
import type { MaterializedOpportunity } from '@/lib/advantage-materialize'

// GET /api/opportunities — materialized opportunities ranked by Advantage
// Score. Empty list when the table isn't migrated yet (dashboard falls back
// to its in-memory ranking).
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
    .from('opportunities')
    .select('canonical_topic, demand, monetization, momentum, whitespace, fit_to_you, advantage_score, components, updated_at')
    .eq('project_id', DEFAULT_PROJECT)
    .order('advantage_score', { ascending: false })
    .limit(50)

  if (error) {
    console.warn('[opportunities] read failed:', error.message)
    return Response.json({ opportunities: [], updatedAt: null })
  }

  const opportunities: MaterializedOpportunity[] = (data ?? []).map((r) => {
    const c = (r.components ?? {}) as Record<string, unknown>
    return {
      topic: r.canonical_topic as string,
      advantage: Number(r.advantage_score) || 0,
      demand: Number(r.demand) || 0,
      monetization: Number(r.monetization) || 0,
      momentum: Number(r.momentum) || 0,
      whitespace: Number(r.whitespace) || 0,
      fitToYou: Number(r.fit_to_you) || 0,
      contributions: (c.contributions as MaterializedOpportunity['contributions']) ?? {
        demand: 0, monetization: 0, momentum: 0, whitespace: 0, fitToYou: 0,
      },
      confirmedSources: Array.isArray(c.confirmedSources) ? (c.confirmedSources as string[]) : [],
      posts: typeof c.posts === 'number' ? c.posts : 0,
      subreddits: Array.isArray(c.subreddits) ? (c.subreddits as string[]) : [],
      updatedAt: r.updated_at ? new Date(r.updated_at as string).getTime() : undefined,
    }
  })

  const updatedAt = data && data.length > 0 ? new Date(data[0].updated_at as string).getTime() : null
  return Response.json({ opportunities, updatedAt })
}
