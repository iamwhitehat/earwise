import type { NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabase } from '@/lib/supabase'
import { generateBlogOutline, expandBlogPost, type BlogOutlineSection } from '@/lib/blog'

// POST /api/blog
//   { mode: 'outline' }                       -> { outline }
//   { mode: 'expand', title, sections[] }     -> { post }
// Context (top opportunity + buyer phrases) is read server-side so the post is
// grounded in real demand. maxDuration bumped — the expand pass writes a full post.
export const maxDuration = 120

async function buildContext(db: SupabaseClient): Promise<string> {
  let topic: string | null = null
  let phrases: string[] = []
  try {
    const opp = await db.from('opportunities').select('canonical_topic').order('advantage_score', { ascending: false }).limit(1).maybeSingle()
    topic = (opp.data?.canonical_topic as string | undefined) ?? null
  } catch { /* table may be absent */ }
  try {
    const bl = await db.from('buyer_language').select('phrases').order('generated_at', { ascending: false }).limit(1).maybeSingle()
    const raw = bl.data?.phrases
    if (Array.isArray(raw)) phrases = raw.map((p) => (p && typeof p === 'object' ? String((p as { text?: unknown }).text ?? '') : '')).filter(Boolean).slice(0, 8)
  } catch { /* table may be absent */ }

  let ctx = topic ? `Top demand opportunity from the market: "${topic}".` : 'A B2B founder looking for a content angle from market demand.'
  if (phrases.length) ctx += ` Recurring buyer phrases to weave in naturally: ${phrases.map((p) => `"${p}"`).join(', ')}.`
  return ctx
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {}
  try { body = (await req.json()) as Record<string, unknown> } catch { /* empty body = outline */ }

  let db
  try { db = getSupabase() } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Configuration error' }, { status: 500 })
  }

  try {
    const context = await buildContext(db)
    if (body.mode === 'expand') {
      const title = typeof body.title === 'string' ? body.title : ''
      const sections = Array.isArray(body.sections)
        ? (body.sections as unknown[]).filter((s): s is BlogOutlineSection => !!s && typeof s === 'object' && typeof (s as BlogOutlineSection).title === 'string')
        : []
      if (!title || sections.length === 0) return Response.json({ error: 'Provide a title and sections to expand' }, { status: 400 })
      const post = await expandBlogPost(title, sections, context)
      if (!post) return Response.json({ error: 'Claude returned no post. Try again.' }, { status: 502 })
      return Response.json({ post })
    }
    const outline = await generateBlogOutline(context)
    if (!outline) return Response.json({ error: 'Claude returned no outline. Try again.' }, { status: 502 })
    return Response.json({ outline })
  } catch (err) {
    console.error('[blog] generation error:', err)
    return Response.json({ error: err instanceof Error ? err.message : 'Generation failed' }, { status: 500 })
  }
}
