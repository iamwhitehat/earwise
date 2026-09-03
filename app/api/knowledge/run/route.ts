import { getSupabase } from '@/lib/supabase'
import { activeProjectId } from '@/lib/project-server'
import { runKnowledgeAgent } from '@/lib/knowledge-agent'

// POST /api/knowledge/run — run the Knowledge Agent on demand: rewatch the
// accumulated market intelligence and curate durable, organized knowledge into
// business_memory (deduped, so a repeat run adds nothing new). Cost: one
// Claude Haiku call. Also runs on schedule via /api/cron/run.

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

  try {
    const result = await runKnowledgeAgent(db, await activeProjectId())
    return Response.json({ ok: true, ...result })
  } catch (err) {
    console.error('[knowledge] run failed:', err)
    return Response.json(
      { error: err instanceof Error ? err.message : 'Knowledge run failed' },
      { status: 500 },
    )
  }
}
