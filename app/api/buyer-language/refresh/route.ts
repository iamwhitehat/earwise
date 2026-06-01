import type { NextRequest } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { extractBuyerLanguage, synthesizeMessaging, resolveSynthModel } from '@/lib/claude'
import {
  aggregateBuyerLanguageSamples,
  enrichContexts,
  renderMessagingInput,
} from '@/lib/buyer-language-aggregator'

// POST /api/buyer-language/refresh — runs the aggregator (1-2 small queries),
// hands sampled text to Claude for phrase + emotional extraction, INSERTs a
// new buyer_language row, and returns the payload. Tools are aggregated
// entirely in JS (we already have the structured tools[] field on posts).

export async function POST(req: NextRequest) {
  let tier: unknown
  try {
    tier = (await req.json())?.tier
  } catch {
    tier = undefined
  }
  const model = resolveSynthModel(tier)

  let db
  try {
    db = getSupabase()
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Configuration error' },
      { status: 500 }
    )
  }

  let aggregated
  try {
    aggregated = await aggregateBuyerLanguageSamples(db)
  } catch (err) {
    console.error('[buyer-language] aggregation failed:', err)
    return Response.json(
      {
        error:
          (err instanceof Error ? err.message : 'Aggregation failed') +
          '. If a missing column or table is named, run section 2b-octies in SETUP.md.',
      },
      { status: 500 }
    )
  }

  if (aggregated.samples.length === 0) {
    return Response.json(
      { error: 'No classified posts or comments yet — scan and deep-scan some posts first.' },
      { status: 400 }
    )
  }

  const extracted = await extractBuyerLanguage(aggregated.samples, model)

  // Build the final stored shape. Phrase/emotional counts come from how many
  // contexts Claude attached (rough proxy — better than nothing without an
  // exact substring scan over the whole corpus). Each context is enriched
  // with subreddit + category from postMeta so the /language page can filter.
  const phrases = extracted.commonPhrases.map((p) => ({
    text: p.text,
    count: p.contexts.length,
    contexts: enrichContexts(p.contexts, aggregated.postMeta),
  }))
  const emotional = extracted.emotionalLanguage.map((p) => ({
    text: p.text,
    count: p.contexts.length,
    contexts: enrichContexts(p.contexts, aggregated.postMeta),
  }))
  // Tools already include enriched contexts from the JS aggregator.
  const tools = aggregated.tools

  // Customer Voice v2: generate ready-to-use messaging from the verbatim
  // quotes + extracted phrases/tools.
  const vocText = renderMessagingInput({
    phrases: extracted.commonPhrases.map((p) => p.text),
    emotional: extracted.emotionalLanguage.map((p) => p.text),
    tools: tools.map((t) => t.text),
    quotes: aggregated.samples.map((s) => s.text),
  })
  const messaging = await synthesizeMessaging(vocText, model)

  const row: Record<string, unknown> = { phrases, tools, emotional, stats: aggregated.stats }
  if (messaging) row.messaging = messaging

  let inserted = await db
    .from('buyer_language')
    .insert(row)
    .select('id, generated_at')
    .single()

  // Tolerant of a not-yet-migrated `messaging` column: retry without it so the
  // rest of the run still persists.
  if (inserted.error && /messaging/.test(inserted.error.message) && messaging) {
    const rest = { phrases, tools, emotional, stats: aggregated.stats }
    inserted = await db.from('buyer_language').insert(rest).select('id, generated_at').single()
  }

  const { data, error } = inserted
  if (error || !data) {
    console.error('[supabase] buyer_language insert error:', error)
    return Response.json(
      {
        error: `Database insert failed: ${error?.message ?? 'unknown'}. ` +
          `Confirm migration 2b-octies has run (see SETUP.md).`,
      },
      { status: 500 }
    )
  }

  return Response.json({
    id: data.id,
    phrases,
    tools,
    emotional,
    messaging,
    stats: aggregated.stats,
    generatedAt: new Date(data.generated_at as string).getTime(),
  })
}
