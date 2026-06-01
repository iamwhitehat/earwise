import type { NextRequest } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { synthesizeStrategy, resolveSynthModel } from '@/lib/claude'
import { aggregateInsights, renderAggregatedForClaude } from '@/lib/insights-aggregator'
import {
  normalizeProfile,
  profileIsEmpty,
  assembleStrategyInput,
  inputsHash,
  STRATEGY_PROMPT_VERSION,
  type BusinessProfile,
} from '@/lib/strategy'
import { memoryDigest } from '@/lib/memory-db'

const NDJSON_HEADERS = {
  'Content-Type': 'application/x-ndjson; charset=utf-8',
  'Cache-Control': 'no-store',
}

type Sink = { send: (e: object) => void; close: () => void }

function ndjsonStream(work: (sink: Sink) => Promise<void>): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      const sink: Sink = {
        send: (e) => {
          if (!closed) controller.enqueue(encoder.encode(JSON.stringify(e) + '\n'))
        },
        close: () => {
          if (!closed) {
            closed = true
            controller.close()
          }
        },
      }
      try {
        await work(sink)
      } catch (err) {
        sink.send({ type: 'error', message: err instanceof Error ? err.message : 'Internal error' })
      } finally {
        sink.close()
      }
    },
  })
  return new Response(stream, { headers: NDJSON_HEADERS })
}

// POST /api/strategy/run — stream the strategist pipeline as NDJSON:
//   {type:'step', key, label, status:'running'|'done'}   per stage
//   {type:'done', run}                                   final brief + metadata
//   {type:'error', message}                              on failure
//
// Body: { tier?, profile? }. If a profile is provided it's saved + used;
// otherwise the latest saved profile is loaded.
export async function POST(req: NextRequest) {
  let body: { tier?: unknown; profile?: unknown } = {}
  try {
    body = (await req.json()) ?? {}
  } catch {
    body = {}
  }
  const model = resolveSynthModel(body.tier)
  const bodyProfile = body.profile ? normalizeProfile(body.profile) : null

  let db
  try {
    db = getSupabase()
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Configuration error' },
      { status: 500 }
    )
  }

  return ndjsonStream(async (sink) => {
    // 1. Profile.
    sink.send({ type: 'step', key: 'profile', label: 'Loading your profile', status: 'running' })
    let profile: BusinessProfile | null = bodyProfile
    if (profile) {
      // Persist the freshly-submitted profile (append-only history).
      const { error } = await db.from('business_profile').insert({ profile })
      if (error) throw new Error(`Saving profile failed: ${error.message}`)
    } else {
      const { data, error } = await db
        .from('business_profile')
        .select('profile')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw new Error(`Loading profile failed: ${error.message}`)
      profile = data ? normalizeProfile(data.profile) : null
    }
    if (!profile || profileIsEmpty(profile)) {
      throw new Error('Fill in your business profile first, then run the strategist.')
    }
    sink.send({ type: 'step', key: 'profile', label: 'Loading your profile', status: 'done' })

    // 2. Aggregate market intelligence.
    sink.send({ type: 'step', key: 'intel', label: 'Aggregating market intelligence', status: 'running' })
    const aggregated = await aggregateInsights(db)
    if (aggregated.postCount === 0) {
      throw new Error('No classified posts yet — scan some subreddits first.')
    }
    const intelligenceText = renderAggregatedForClaude(aggregated)
    sink.send({
      type: 'step',
      key: 'intel',
      label: `Aggregated ${aggregated.postCount} posts across ${aggregated.opportunities.length} opportunities`,
      status: 'done',
    })

    // 3. Synthesize the plan.
    sink.send({ type: 'step', key: 'plan', label: 'Writing your go-to-market plan', status: 'running' })
    const input = assembleStrategyInput(profile, intelligenceText)
    const brief = await synthesizeStrategy(input, model, await memoryDigest(db))
    if (!brief) throw new Error('The model returned no plan. Try again or scan more posts first.')
    sink.send({ type: 'step', key: 'plan', label: 'Plan ready', status: 'done' })

    // 4. Persist the run (with model + prompt version + inputs hash).
    sink.send({ type: 'step', key: 'save', label: 'Saving', status: 'running' })
    const hash = inputsHash(input)
    const { data, error } = await db
      .from('strategy_runs')
      .insert({ brief, model, prompt_version: STRATEGY_PROMPT_VERSION, inputs_hash: hash })
      .select('id, created_at')
      .single()
    if (error || !data) throw new Error(`Saving the run failed: ${error?.message ?? 'unknown'}`)
    sink.send({ type: 'step', key: 'save', label: 'Saved', status: 'done' })

    sink.send({
      type: 'done',
      run: {
        id: data.id,
        brief,
        model,
        promptVersion: STRATEGY_PROMPT_VERSION,
        inputsHash: hash,
        generatedAt: new Date(data.created_at as string).getTime(),
      },
    })
  })
}
