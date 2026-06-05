import type { NextRequest } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { activeProjectId } from '@/lib/project-server'
import { gateUsage } from '@/lib/usage-credits-db'
import { ingestSources, type IngestQueries } from '@/lib/sources/ingest'

const MAX_QUERIES = 20

function strList(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean).slice(0, MAX_QUERIES)
    : []
}

// POST /api/sources/ingest
// Body: { reddit?: string[], hackernews?: string[], stackoverflow?: string[], tier? }
//   reddit       → subreddit names
//   hackernews   → search queries
//   stackoverflow→ search queries (unanswered questions)
// Runs the live connectors, classifies + canonicalizes + (optionally) embeds
// the new signals, dedupes across sources, and stores them in `signals`.
export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const b = (body ?? {}) as Record<string, unknown>
  const queries: IngestQueries = {
    reddit: strList(b.reddit),
    hackernews: strList(b.hackernews),
    stackoverflow: strList(b.stackoverflow),
  }
  const total =
    (queries.reddit?.length ?? 0) + (queries.hackernews?.length ?? 0) + (queries.stackoverflow?.length ?? 0)
  if (total === 0) {
    return Response.json(
      { error: 'Provide at least one of: reddit[], hackernews[], stackoverflow[]' },
      { status: 400 }
    )
  }

  let db
  try {
    db = getSupabase()
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Configuration error' },
      { status: 500 }
    )
  }

  // Usage-credit gate (margin guard) — ingest classifies new signals via Haiku.
  // Charge per classify-batch; new signals are capped at MAX_NEW_PER_RUN (60) =
  // ~8 batches, so cap the up-front estimate at 8.
  const units = Math.min(8, total)
  const over = await gateUsage(db, await activeProjectId(), 'scan', { units })
  if (over) return over

  try {
    const result = await ingestSources(db, queries, { signal: req.signal })
    return Response.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Ingestion failed'
    console.error('[sources/ingest] error:', err)
    return Response.json(
      {
        error: `${message}. If a missing table is named, run the multi-source migration in SETUP.md (2b-quaterdecies).`,
      },
      { status: 500 }
    )
  }
}
