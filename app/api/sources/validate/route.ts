import type { NextRequest } from 'next/server'
import { CONNECTORS } from '@/lib/sources'
import { findFirstMatch } from '@/lib/intent-patterns'
import { classifyAndExtractBatch } from '@/lib/claude'
import { rawEngagement } from '@/lib/score-norm'
import type { RawSignal } from '@/lib/sources/types'

// Phase-1 VALIDATION GATE (read-only). Answers the brief's actual question:
// "does the niche's pain-signal exist on a given source, and how dense is it?"
// Reuses the real engine — the source connector, the intent matcher, and the
// Haiku classifier — so the density reflects genuine yield, not a toy probe.
//
//   GET /api/sources/validate?source=hackernews&q=term1,term2,...
//
// Defaults to Hacker News + the no-code-migration query set. Returns a density
// report; classifies at most CLASSIFY_CAP of the strongest-engagement hits.
export const maxDuration = 120

const DEFAULT_QUERIES = [
  'migrate off bubble',
  'airtable pricing',
  'no-code limitations',
  'outgrew webflow',
  'low-code limits',
  'retool alternative',
  'bubble.io scaling',
]
const PAIN_CATEGORIES = new Set(['pain_point', 'feature_request', 'tool_complaint'])
const CLASSIFY_CAP = 80

// Same auth posture as /api/cron/run: CRON_SECRET gates it; unset → dev/localhost open.
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  if (req.headers.get('authorization') === `Bearer ${secret}`) return true
  return new URL(req.url).searchParams.get('key') === secret
}

function stats(values: number[]): { min: number; median: number; p90: number; max: number } {
  if (values.length === 0) return { min: 0, median: 0, p90: 0, max: 0 }
  const s = [...values].sort((a, b) => a - b)
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))]
  return { min: s[0], median: at(0.5), p90: at(0.9), max: s[s.length - 1] }
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const sourceId = url.searchParams.get('source') || 'hackernews'
  const connector = CONNECTORS[sourceId]
  if (!connector) {
    return Response.json({ error: `Unknown source '${sourceId}'. Try one of: ${Object.keys(CONNECTORS).join(', ')}` }, { status: 400 })
  }
  const qParam = url.searchParams.get('q')
  const queries = qParam ? qParam.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_QUERIES

  // 1) Fetch each query through the real connector; dedup by externalId.
  const perQuery: { query: string; hits: number }[] = []
  const byId = new Map<string, RawSignal>()
  for (const q of queries) {
    const got = await connector.search(q, req.signal)
    perQuery.push({ query: q, hits: got.length })
    for (const s of got) if (!byId.has(s.externalId)) byId.set(s.externalId, s)
  }
  const signals = [...byId.values()]
  const hits = signals.length

  if (hits === 0) {
    return Response.json({ source: sourceId, queries, hits: 0, verdict: 'DRY — no results for this query set', perQuery })
  }

  // 2) Intent-pattern match (free, regex) over title + body.
  const intentMatches = signals.filter((s) => findFirstMatch(`${s.title}\n${s.body}`) !== null).length

  // 3) Classify the strongest-engagement hits (bounded) with the real Haiku batch.
  const ranked = [...signals].sort((a, b) => rawEngagement(b.engagement) - rawEngagement(a.engagement))
  const toClassify = ranked.slice(0, CLASSIFY_CAP)
  const classified = await classifyAndExtractBatch(
    toClassify.map((s) => ({ title: s.title, selftext: s.body })),
  )
  const painOrFeature = classified.filter((c) => PAIN_CATEGORIES.has(c.category)).length
  const categoryBreakdown = classified.reduce<Record<string, number>>((acc, c) => {
    acc[c.category] = (acc[c.category] ?? 0) + 1
    return acc
  }, {})

  // 4) Density = pain/feature share of the classified sample. The go/no-go metric.
  const classifiedN = toClassify.length
  const density = classifiedN > 0 ? painOrFeature / classifiedN : 0
  const engagement = stats(signals.map((s) => rawEngagement(s.engagement)))

  return Response.json({
    source: sourceId,
    queries,
    hits,
    perQuery,
    intentMatches,
    intentMatchRate: Number((intentMatches / hits).toFixed(3)),
    classified: classifiedN,
    truncated: hits > CLASSIFY_CAP,
    painOrFeature,
    categoryBreakdown,
    density: Number(density.toFixed(3)),
    engagement,
    verdict:
      density >= 0.2
        ? `SIGNAL — ${(density * 100).toFixed(0)}% of classified hits are pain/feature (≥20% gate cleared)`
        : `THIN — only ${(density * 100).toFixed(0)}% pain/feature (below 20% gate)`,
    sampleMatches: ranked
      .slice(0, 8)
      .map((s) => ({ title: s.title, url: s.url, engagement: rawEngagement(s.engagement) })),
  })
}
