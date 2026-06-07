import type { NextRequest } from 'next/server'
import type Anthropic from '@anthropic-ai/sdk'
import { getSupabase } from '@/lib/supabase'
import { callStructured, SYNTH_MODELS, type SynthTier } from '@/lib/claude'
import { loadDemandRows } from '@/lib/demand-rows'

// GET /api/sources/brief?q=lead,client,...  — a grounded BUILD BRIEF for one
// theme. Reads the real posts behind it (posts + signals) and extracts the
// dimensions that actually decide what to build: ICP sub-segment, jobs-to-be-
// done, tools-tried-and-why-they-fail (the wedge), willingness-to-pay, ranked
// MVP features, risks, and verbatim quotes. One strong-model call (default
// Sonnet; ?model=max for Opus). ?q=keywords (required) · ?source · ?limit
export const maxDuration = 120
const CORPUS_CAP = 70

const BRIEF_TOOL: Anthropic.Messages.Tool = {
  name: 'build_brief',
  description: 'A grounded product brief for a solo founder, derived ONLY from the supplied posts.',
  input_schema: {
    type: 'object',
    properties: {
      icp: {
        type: 'array',
        description: 'Buyer sub-segments, ranked by how acute + homogeneous their pain is',
        items: { type: 'object', properties: { segment: { type: 'string' }, whyAcute: { type: 'string' } }, required: ['segment', 'whyAcute'] },
      },
      jobsToBeDone: { type: 'array', items: { type: 'string' }, description: 'Specific tasks/needs they are failing at' },
      currentTools: {
        type: 'array',
        description: 'Tools they already use/tried and the complaint — this gap is the wedge',
        items: { type: 'object', properties: { tool: { type: 'string' }, complaint: { type: 'string' } }, required: ['tool', 'complaint'] },
      },
      willingnessToPay: { type: 'array', items: { type: 'string' }, description: 'Spend / would-pay signals (what they pay now or say they would)' },
      mvpFeatures: { type: 'array', items: { type: 'string' }, description: 'Ranked must-have features for a first version' },
      wedge: { type: 'string', description: 'The single differentiated angle vs existing tools' },
      risks: { type: 'array', items: { type: 'string' }, description: 'Honest reasons this might not work' },
      quotes: { type: 'array', items: { type: 'string' }, description: '5 verbatim pain quotes from the posts' },
    },
    required: ['icp', 'jobsToBeDone', 'currentTools', 'willingnessToPay', 'mvpFeatures', 'wedge', 'risks', 'quotes'],
  },
}

const SYSTEM =
  'You are a sharp, skeptical product researcher for a SOLO founder who ships small low/no-cost tools. ' +
  'From the REAL posts below (people voicing one theme of pain), produce a build brief. Extract ONLY what ' +
  'the posts support — do NOT invent demand, tools, or willingness-to-pay the text does not show. Rank ICP ' +
  'sub-segments by how acute and homogeneous their pain is (a narrow segment with identical sharp pain beats ' +
  'a broad vague one). The "tools they tried + why they failed" is the most important section — it is the ' +
  'wedge. Be concrete. If the signal is thin or contradictory, say so in risks.'

export async function GET(req: NextRequest) {
  let db
  try { db = getSupabase() } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Configuration error' }, { status: 500 })
  }
  const params = new URL(req.url).searchParams
  const keywords = (params.get('q') ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  const source = params.get('source')
  if (keywords.length === 0) return Response.json({ error: 'pass ?q=keyword,keyword (the theme keywords)' }, { status: 400 })
  const tier = params.get('model')
  const model = tier && tier in SYNTH_MODELS ? SYNTH_MODELS[tier as SynthTier] : SYNTH_MODELS.balanced

  const rows = await loadDemandRows(db, { source })
  const matched = rows.filter((r) => {
    const hay = `${r.title} ${r.body}`.toLowerCase()
    return keywords.some((k) => hay.includes(k))
  })
  if (matched.length === 0) return Response.json({ matched: 0, error: 'No posts match those keywords' }, { status: 404 })

  const corpus = matched
    .slice(0, CORPUS_CAP)
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.body.replace(/\s+/g, ' ').trim().slice(0, 280)}`)
    .join('\n\n')

  const brief = await callStructured(model, SYSTEM, `Theme posts (${matched.length} total, showing ${Math.min(matched.length, CORPUS_CAP)}):\n\n${corpus}`, BRIEF_TOOL, 2600)
  if (!brief) return Response.json({ matched: matched.length, error: 'Synthesis returned nothing — try again or ?model=max' }, { status: 502 })
  return Response.json({ matched: matched.length, analyzed: Math.min(matched.length, CORPUS_CAP), model, brief })
}
