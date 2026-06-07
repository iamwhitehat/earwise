import type { NextRequest } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { canonicalTopic } from '@/lib/topics'

// GET /api/sources/demand — a clean read of demand topics straight from the
// multi-source `signals` table (ingest target), grouped by canonical topic.
// Independent of the materialized `opportunities` table, so it isn't diluted by
// legacy `posts` data — the fastest "what is my niche asking for" view for the
// private demand-finder loop. Counts pain/feature/complaint signals only.
//   ?source=reddit (filter)  ·  ?limit=15
const DEMAND_CATEGORIES = ['pain_point', 'feature_request', 'tool_complaint']

export async function GET(req: NextRequest) {
  let db
  try { db = getSupabase() } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Configuration error' }, { status: 500 })
  }
  const url = new URL(req.url)
  const source = url.searchParams.get('source')
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 15))

  let q = db
    .from('signals')
    .select('source, category, topic, canonical_topic, title, author, url')
    .in('category', DEMAND_CATEGORIES)
    .order('ingested_at', { ascending: false })
    .limit(5000)
  if (source) q = q.eq('source', source)
  const { data, error } = await q
  if (error) return Response.json({ error: error.message }, { status: 500 })

  type Agg = { count: number; authors: Set<string>; sources: Set<string>; cats: Record<string, number>; examples: { title: string; url: string }[] }
  const byTopic = new Map<string, Agg>()
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const topic = canonicalTopic((r.canonical_topic as string | null) ?? (r.topic as string | null))
    if (!topic) continue
    let a = byTopic.get(topic)
    if (!a) { a = { count: 0, authors: new Set(), sources: new Set(), cats: {}, examples: [] }; byTopic.set(topic, a) }
    a.count++
    const author = (r.author as string | null) ?? ''
    if (author) a.authors.add(author.toLowerCase())
    a.sources.add((r.source as string | null) ?? 'reddit')
    const cat = (r.category as string) ?? 'other'
    a.cats[cat] = (a.cats[cat] ?? 0) + 1
    const title = ((r.title as string | null) ?? '').trim()
    if (title && a.examples.length < 3) a.examples.push({ title, url: (r.url as string | null) ?? '' })
  }

  const topics = Array.from(byTopic.entries())
    .map(([topic, a]) => ({
      topic,
      count: a.count,
      uniqueAuthors: a.authors.size,
      sources: Array.from(a.sources).sort(),
      categories: a.cats,
      examples: a.examples,
    }))
    .sort((x, y) => y.count - x.count || y.uniqueAuthors - x.uniqueAuthors)
    .slice(0, limit)

  return Response.json({ totalSignals: data?.length ?? 0, topics })
}
