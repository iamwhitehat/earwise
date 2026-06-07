import type { NextRequest } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { canonicalTopic } from '@/lib/topics'
import { loadDemandRows } from '@/lib/demand-rows'

// GET /api/sources/demand — demand topics grouped by canonical topic, from BOTH
// the `posts` (app "Scan for new") and `signals` (API ingest) tables.
//   ?source=reddit (filter)  ·  ?limit=15
export async function GET(req: NextRequest) {
  let db
  try { db = getSupabase() } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Configuration error' }, { status: 500 })
  }
  const url = new URL(req.url)
  const source = url.searchParams.get('source')
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 15))

  const rows = await loadDemandRows(db, { source })

  type Agg = { count: number; authors: Set<string>; sources: Set<string>; cats: Record<string, number>; examples: { title: string; url: string }[] }
  const byTopic = new Map<string, Agg>()
  for (const r of rows) {
    const topic = canonicalTopic(r.topic)
    if (!topic) continue
    let a = byTopic.get(topic)
    if (!a) { a = { count: 0, authors: new Set(), sources: new Set(), cats: {}, examples: [] }; byTopic.set(topic, a) }
    a.count++
    if (r.author) a.authors.add(r.author.toLowerCase())
    a.sources.add(r.source)
    a.cats[r.category] = (a.cats[r.category] ?? 0) + 1
    if (r.title && a.examples.length < 3) a.examples.push({ title: r.title, url: r.url })
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

  return Response.json({ totalSignals: rows.length, topics })
}
