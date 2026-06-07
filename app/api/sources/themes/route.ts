import type { NextRequest } from 'next/server'
import type Anthropic from '@anthropic-ai/sdk'
import { getSupabase } from '@/lib/supabase'
import { canonicalTopic } from '@/lib/topics'
import { callStructured, MODEL_BULK } from '@/lib/claude'

// GET /api/sources/themes — ONE Haiku pass that collapses the over-granular
// demand topics (from the `signals` table) into a few broad, ranked "build
// candidates". Cheap (single Haiku call), clean (reads signals, not the diluted
// opportunities table). The private demand-finder's "what should I build" view.
//   ?source=reddit (filter)
const DEMAND_CATEGORIES = ['pain_point', 'feature_request', 'tool_complaint']

const THEMES_TOOL: Anthropic.Messages.Tool = {
  name: 'demand_themes',
  description: 'Cluster granular demand topics into 4–6 broad, buildable themes ranked by demand.',
  input_schema: {
    type: 'object',
    properties: {
      themes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            theme: { type: 'string', description: 'Short theme name' },
            pain: { type: 'string', description: 'The recurring underlying pain, one line' },
            toolIdea: { type: 'string', description: 'A concrete low/no-cost tool that solves it' },
            topics: { type: 'array', items: { type: 'string' }, description: 'Input topics this theme covers' },
            demand: { type: 'number', description: 'Sum of post counts across covered topics' },
          },
          required: ['theme', 'pain', 'toolIdea', 'demand'],
        },
      },
    },
    required: ['themes'],
  },
}

const SYSTEM =
  'You are a skeptical product strategist for a solo founder who ships small, low- or no-cost tools. ' +
  'Cluster the demand topics below into 4–6 BROAD, buildable themes. For each: a short theme name, the ' +
  'recurring pain in one line, a concrete cheap tool idea, the covered input topics, and demand = sum of ' +
  'their post counts. Rank by demand. Only surface genuinely recurring pains — if a topic is a one-off, ' +
  'leave it out rather than inflate a theme.'

export async function GET(req: NextRequest) {
  let db
  try { db = getSupabase() } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Configuration error' }, { status: 500 })
  }
  const source = new URL(req.url).searchParams.get('source')

  let q = db
    .from('signals')
    .select('source, category, topic, canonical_topic, title')
    .in('category', DEMAND_CATEGORIES)
    .order('ingested_at', { ascending: false })
    .limit(5000)
  if (source) q = q.eq('source', source)
  const { data, error } = await q
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const byTopic = new Map<string, { count: number; example: string }>()
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const t = canonicalTopic((r.canonical_topic as string | null) ?? (r.topic as string | null))
    if (!t) continue
    const a = byTopic.get(t) ?? { count: 0, example: '' }
    a.count++
    if (!a.example) {
      const title = ((r.title as string | null) ?? '').trim()
      if (title) a.example = title.slice(0, 90)
    }
    byTopic.set(t, a)
  }
  if (byTopic.size === 0) return Response.json({ totalTopics: 0, totalSignals: data?.length ?? 0, themes: [] })

  const list = Array.from(byTopic.entries())
    .sort((x, y) => y[1].count - x[1].count)
    .map(([t, a]) => `- ${t} (${a.count})${a.example ? `: "${a.example}"` : ''}`)
    .join('\n')

  const out = await callStructured<{ themes?: unknown[] }>(
    MODEL_BULK, SYSTEM, `Demand topics — "topic (post count): example":\n${list}`, THEMES_TOOL, 1500,
  )
  const themes = Array.isArray(out?.themes) ? out.themes : []
  return Response.json({ totalTopics: byTopic.size, totalSignals: data?.length ?? 0, themes })
}
