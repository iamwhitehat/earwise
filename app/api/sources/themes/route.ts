import type { NextRequest } from 'next/server'
import type Anthropic from '@anthropic-ai/sdk'
import { getSupabase } from '@/lib/supabase'
import { canonicalTopic } from '@/lib/topics'
import { callStructured, SYNTH_MODELS, type SynthTier } from '@/lib/claude'
import { loadDemandRows } from '@/lib/demand-rows'

// GET /api/sources/themes — ONE synthesis pass that collapses the over-granular
// demand topics (from BOTH `posts` and `signals`) into a few broad, ranked
// "build candidates". ?source=reddit · ?model=fast|balanced|max (default Sonnet).

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
  const params = new URL(req.url).searchParams
  const source = params.get('source')
  // Synthesis model is selectable — this single call is high-leverage + cheap.
  const tier = params.get('model')
  const model = tier && tier in SYNTH_MODELS ? SYNTH_MODELS[tier as SynthTier] : SYNTH_MODELS.balanced

  const rows = await loadDemandRows(db, { source })

  const byTopic = new Map<string, { count: number; example: string }>()
  for (const r of rows) {
    const t = canonicalTopic(r.topic)
    if (!t) continue
    const a = byTopic.get(t) ?? { count: 0, example: '' }
    a.count++
    if (!a.example && r.title.trim()) a.example = r.title.trim().slice(0, 90)
    byTopic.set(t, a)
  }
  if (byTopic.size === 0) return Response.json({ totalTopics: 0, totalSignals: rows.length, themes: [] })

  const list = Array.from(byTopic.entries())
    .sort((x, y) => y[1].count - x[1].count)
    .map(([t, a]) => `- ${t} (${a.count})${a.example ? `: "${a.example}"` : ''}`)
    .join('\n')

  const out = await callStructured<{ themes?: unknown[] }>(
    model, SYSTEM, `Demand topics — "topic (post count): example":\n${list}`, THEMES_TOOL, 1800,
  )
  const themes = Array.isArray(out?.themes) ? out.themes : []
  return Response.json({ totalTopics: byTopic.size, totalSignals: rows.length, model, themes })
}
