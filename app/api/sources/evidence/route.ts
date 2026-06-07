import type { NextRequest } from 'next/server'
import { getSupabase } from '@/lib/supabase'

// GET /api/sources/evidence?q=invoice,payment,...  — the raw posts behind a
// theme. Returns demand signals whose title/body match any keyword, so you can
// read the pain in buyers' own words before committing to a build. Free DB read.
//   ?q=comma,separated,keywords (required)  ·  ?source=reddit  ·  ?limit=20
const DEMAND_CATEGORIES = ['pain_point', 'feature_request', 'tool_complaint']

export async function GET(req: NextRequest) {
  let db
  try { db = getSupabase() } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Configuration error' }, { status: 500 })
  }
  const params = new URL(req.url).searchParams
  const keywords = (params.get('q') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const source = params.get('source')
  const limit = Math.min(40, Math.max(1, Number(params.get('limit')) || 20))
  if (keywords.length === 0) return Response.json({ error: 'pass ?q=keyword,keyword' }, { status: 400 })

  const clauses: string[] = []
  for (const kw of keywords) {
    const safe = kw.replace(/[*(),]/g, '')
    clauses.push(`title.ilike.*${safe}*`, `body.ilike.*${safe}*`)
  }

  let query = db
    .from('signals')
    .select('title, body, url, author, category, topic, source')
    .in('category', DEMAND_CATEGORIES)
    .or(clauses.join(','))
    .order('ingested_at', { ascending: false })
    .limit(limit)
  if (source) query = query.eq('source', source)

  const { data, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const items = (data ?? []).map((r) => {
    const row = r as Record<string, unknown>
    return {
      title: (row.title as string | null) ?? '',
      snippet: ((row.body as string | null) ?? '').replace(/\s+/g, ' ').trim().slice(0, 320),
      url: (row.url as string | null) ?? '',
      author: (row.author as string | null) ?? '',
      category: (row.category as string | null) ?? '',
      topic: (row.topic as string | null) ?? '',
    }
  })
  return Response.json({ count: items.length, items })
}
