import type { NextRequest } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { summarizeTrend } from '@/lib/claude'
import { canonicalTopic } from '@/lib/topics'

const VOCAB_CAP = 5000

const SAMPLE_SIZE = 30

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const topic = url.searchParams.get('topic')?.trim()
  if (!topic) {
    return Response.json({ error: 'Missing topic parameter' }, { status: 400 })
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

  // 1. Cache hit?
  const { data: cached, error: cachedErr } = await db
    .from('trend_insights')
    .select('insight')
    .eq('topic', topic)
    .maybeSingle()

  if (cachedErr) {
    console.error('[supabase] trend_insights select error:', cachedErr)
    return Response.json(
      { error: 'Database query failed — confirm the trend_insights table exists. See SETUP.md (2b-ter).' },
      { status: 500 }
    )
  }

  if (cached?.insight) {
    return Response.json({ insight: cached.insight as string, cached: true })
  }

  // 2. Resolve the canonical topic label to its raw variants. The Trends list
  //    groups by canonical topic (so "lead generation problems", "lead gen
  //    issues", … all merge under "lead generation problem"), but posts.topic
  //    stores the RAW labels — a raw-equality match here finds nothing for a
  //    merged trend. Map the canonical label back to the raw topics that reduce
  //    to it (same pattern as /api/posts-by-topic), then query those.
  const target = canonicalTopic(topic)
  if (!target) {
    return Response.json({ error: `No posts found for topic "${topic}"` }, { status: 404 })
  }

  const { data: vocabRows, error: vocabErr } = await db
    .from('posts')
    .select('topic')
    .not('topic', 'is', null)
    .limit(VOCAB_CAP)
  if (vocabErr) {
    console.error('[supabase] trend-insight vocab error:', vocabErr)
    return Response.json({ error: 'Database query failed' }, { status: 500 })
  }

  const rawTopics = Array.from(
    new Set(
      (vocabRows ?? [])
        .map((r) => r.topic as string)
        .filter((t) => canonicalTopic(t) === target),
    ),
  )
  if (rawTopics.length === 0) {
    return Response.json({ error: `No posts found for topic "${topic}"` }, { status: 404 })
  }

  // Sample titles across all raw variants for the prompt.
  const { data: titleRows, error: titleErr } = await db
    .from('posts')
    .select('title, analyzed_at')
    .in('topic', rawTopics)
    .order('analyzed_at', { ascending: false })
    .limit(SAMPLE_SIZE)

  if (titleErr) {
    console.error('[supabase] trend-insight titles error:', titleErr)
    return Response.json({ error: 'Database query failed' }, { status: 500 })
  }

  const titles = (titleRows ?? []).map((r) => r.title as string).filter(Boolean)
  if (titles.length === 0) {
    return Response.json(
      { error: `No posts found for topic "${topic}"` },
      { status: 404 }
    )
  }

  // 3. Generate via Claude.
  const insight = await summarizeTrend(topic, titles)
  if (!insight) {
    return Response.json({ error: 'Insight generation failed' }, { status: 502 })
  }

  // 4. Persist. Upsert — concurrent requests for the same topic both succeed
  //    and the last writer wins (insights are deterministic enough for this).
  const { error: insertErr } = await db
    .from('trend_insights')
    .upsert({ topic, insight }, { onConflict: 'topic' })
  if (insertErr) console.error('[supabase] trend_insights insert error:', insertErr)

  return Response.json({ insight, cached: false })
}
