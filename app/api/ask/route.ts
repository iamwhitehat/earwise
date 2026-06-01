import type { NextRequest } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { callStructured, resolveSynthModel } from '@/lib/claude'
import { retrieveMarketSources } from '@/lib/ask-db'
import {
  extractKeywords,
  rankSources,
  buildAskUserContent,
  ASK_SYSTEM_PROMPT,
  type AskCitation,
} from '@/lib/ask'

const QUERY_MAX = 300
const TOP_EVIDENCE = 12

const ASK_TOOL = {
  name: 'report_answer',
  description: 'Return a grounded answer plus the evidence numbers it relied on.',
  input_schema: {
    type: 'object' as const,
    properties: {
      answer: { type: 'string', description: 'The grounded answer (2–4 sentences).' },
      used: {
        type: 'array',
        items: { type: 'integer' },
        description: 'The [n] evidence numbers actually used in the answer.',
      },
    },
    required: ['answer', 'used'],
  },
}

// POST /api/ask — natural-language query over the indexed signals/posts.
// Body: { query, tier? }. Returns a grounded answer + citations.
export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const b = (body ?? {}) as { query?: unknown; tier?: unknown }
  const query = typeof b.query === 'string' ? b.query.trim().slice(0, QUERY_MAX) : ''
  if (query.length < 3) {
    return Response.json({ error: 'Ask a question (at least a few characters).' }, { status: 400 })
  }

  const keywords = extractKeywords(query)
  if (keywords.length === 0) {
    return Response.json({ error: 'Try a more specific question — add a topic, tool, or pain.' }, { status: 400 })
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

  const candidates = await retrieveMarketSources(db, keywords)
  const sources = rankSources(candidates, keywords, TOP_EVIDENCE)

  if (sources.length === 0) {
    return Response.json({
      answer:
        "I don't see any indexed posts matching that yet. Scan a few relevant subreddits (or broaden the question) and try again.",
      citations: [],
      scanned: 0,
    })
  }

  const result = await callStructured<{ answer?: unknown; used?: unknown }>(
    resolveSynthModel(b.tier),
    ASK_SYSTEM_PROMPT,
    buildAskUserContent(query, sources),
    ASK_TOOL,
    1200,
  )

  if (!result || typeof result.answer !== 'string') {
    return Response.json({ error: 'Could not synthesize an answer. Try again.' }, { status: 502 })
  }

  const used = Array.isArray(result.used)
    ? result.used.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= sources.length)
    : []
  // De-dupe + map evidence numbers back to their sources.
  const citations: AskCitation[] = [...new Set(used)].map((n) => {
    const s = sources[n - 1]
    return { n, title: s.title, url: s.url, subreddit: s.subreddit, source: s.source }
  })

  return Response.json({ answer: result.answer.trim(), citations, scanned: sources.length })
}
