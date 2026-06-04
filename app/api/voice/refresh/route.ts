import type { NextRequest } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { activeProjectId } from '@/lib/project-server'
import { resolveSynthModel, synthesizeVoiceBrief } from '@/lib/claude'
import { renderMessagingInput } from '@/lib/buyer-language-aggregator'
import { renderProfile, normalizeProfile, EMPTY_PROFILE } from '@/lib/strategy'
import { memoryDigest } from '@/lib/memory-db'
import { saveVoiceBrief, VOICE_BRIEF_MIGRATION_HINT } from '@/lib/voice-brief-db'

// POST /api/voice/refresh — distill the latest buyer-language data + the founder
// profile into a positioning line + angles + copy, persist it, and return it.
// Reuses the already-extracted buyer language (no re-scan). Optional { tier }.

type LangItem = { text?: unknown; contexts?: unknown }

function texts(arr: unknown): string[] {
  return (Array.isArray(arr) ? arr : [])
    .map((it) => (typeof (it as LangItem)?.text === 'string' ? ((it as LangItem).text as string) : ''))
    .filter(Boolean)
}

function quotesFrom(...groups: unknown[]): string[] {
  const out: string[] = []
  for (const g of groups) {
    for (const it of Array.isArray(g) ? g : []) {
      const ctx = (it as LangItem)?.contexts
      for (const c of Array.isArray(ctx) ? ctx : []) {
        const q = (c as { quote?: unknown })?.quote
        if (typeof q === 'string' && q.trim()) out.push(q.trim())
      }
    }
  }
  return out
}

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

  const projectId = await activeProjectId()

  // 1. Ground on the latest buyer-language run (global; not re-scanned).
  const { data: bl, error: blErr } = await db
    .from('buyer_language')
    .select('phrases, tools, emotional')
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (blErr) {
    return Response.json(
      { error: `Buyer-language read failed: ${blErr.message}.` },
      { status: 500 }
    )
  }
  const phrases = texts(bl?.phrases)
  if (!bl || phrases.length === 0) {
    return Response.json(
      { error: 'No customer-voice data yet — open Voice → Words and Refresh first.' },
      { status: 400 }
    )
  }

  const vocText = renderMessagingInput({
    phrases,
    emotional: texts(bl.emotional),
    tools: texts(bl.tools),
    quotes: quotesFrom(bl.phrases, bl.emotional, bl.tools),
  })

  // 2. Ground on the founder's profile + learned memory.
  const { data: profRow } = await db
    .from('business_profile')
    .select('profile')
    .eq('project_id', projectId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const profile = profRow ? normalizeProfile(profRow.profile) : EMPTY_PROFILE
  const profileText = renderProfile(profile)

  // 3. Distill.
  const brief = await synthesizeVoiceBrief(vocText, profileText, model, await memoryDigest(db, projectId))
  if (!brief) {
    return Response.json({ error: 'Claude returned no brief. Try again.' }, { status: 502 })
  }

  // 4. Persist + return.
  try {
    const generatedAt = await saveVoiceBrief(db, brief, model, projectId)
    return Response.json({ brief, model, generatedAt })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    console.error('[voice] save error:', message)
    return Response.json(
      { error: `Database write failed: ${message}. ${VOICE_BRIEF_MIGRATION_HINT}` },
      { status: 500 }
    )
  }
}
