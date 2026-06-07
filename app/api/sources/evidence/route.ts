import type { NextRequest } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { loadDemandRows } from '@/lib/demand-rows'

// GET /api/sources/evidence?q=invoice,payment,...  — the raw posts behind a
// theme, from BOTH `posts` (app scan) and `signals` (API ingest). Returns demand
// rows whose title/body match any keyword, so a build candidate can be checked
// against buyers' own words.  ?q=comma,keywords (required) · ?source · ?limit=20
export async function GET(req: NextRequest) {
  let db
  try { db = getSupabase() } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Configuration error' }, { status: 500 })
  }
  const params = new URL(req.url).searchParams
  const keywords = (params.get('q') ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  const source = params.get('source')
  const limit = Math.min(40, Math.max(1, Number(params.get('limit')) || 20))
  if (keywords.length === 0) return Response.json({ error: 'pass ?q=keyword,keyword' }, { status: 400 })

  const rows = await loadDemandRows(db, { source })
  const items = rows
    .filter((r) => {
      const hay = `${r.title} ${r.body}`.toLowerCase()
      return keywords.some((k) => hay.includes(k))
    })
    .slice(0, limit)
    .map((r) => ({
      title: r.title,
      snippet: r.body.replace(/\s+/g, ' ').trim().slice(0, 320),
      url: r.url,
      author: r.author,
      category: r.category,
      topic: r.topic ?? '',
    }))

  return Response.json({ count: items.length, items })
}
