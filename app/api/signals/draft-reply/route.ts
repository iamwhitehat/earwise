import type { NextRequest } from 'next/server'
import { draftSignalReply } from '@/lib/claude'
import { getSupabase } from '@/lib/supabase'
import { activeProjectId } from '@/lib/project-server'
import { gateUsage } from '@/lib/usage-credits-db'
import { loadVoiceSamples } from '@/lib/voice-db'
import { loadVoiceBrief } from '@/lib/voice-brief-db'
import type { VoiceBrief } from '@/lib/voice-brief'

const MAX_TEXT = 2000
const MAX_FIELD = 200

// Best-effort: the founder's voice samples + distilled positioning sharpen the
// reply but must never block it — a missing/unconfigured DB just falls back to
// the rules. Both loaded off one client, scoped to the active project.
async function voiceContextOrNone(): Promise<{ samples: string[]; brief: VoiceBrief | null }> {
  try {
    const db = getSupabase()
    const projectId = await activeProjectId()
    const [samples, stored] = await Promise.all([
      loadVoiceSamples(db, projectId),
      loadVoiceBrief(db, projectId),
    ])
    return { samples, brief: stored?.brief ?? null }
  } catch {
    return { samples: [], brief: null }
  }
}

// POST /api/signals/draft-reply
// Body: {subreddit, author, text, topic?, intentType?}
// Returns: {reply: string}
// Stateless — runs one Haiku call via the throttled callClaude wrapper.

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const b = (body ?? {}) as Record<string, unknown>
  const subreddit = typeof b.subreddit === 'string' ? b.subreddit.trim() : ''
  const author = typeof b.author === 'string' ? b.author.trim() : ''
  const text = typeof b.text === 'string' ? b.text.trim() : ''
  const topic = typeof b.topic === 'string' ? b.topic.trim().slice(0, MAX_FIELD) : null
  const intentType = typeof b.intentType === 'string' ? b.intentType.trim().slice(0, 40) : undefined

  if (!subreddit || subreddit.length > MAX_FIELD) {
    return Response.json({ error: 'Invalid subreddit' }, { status: 400 })
  }
  if (!text) {
    return Response.json({ error: 'Missing text' }, { status: 400 })
  }
  if (text.length > MAX_TEXT) {
    return Response.json(
      { error: `Text too long (max ${MAX_TEXT} chars)` },
      { status: 400 }
    )
  }

  // Usage-credit gate (margin guard) — Haiku draft.
  try {
    const db = getSupabase()
    const over = await gateUsage(db, await activeProjectId(), 'draft')
    if (over) return over
  } catch {
    /* DB unavailable → chargeCredits would fail-open anyway; proceed. */
  }

  const voice = await voiceContextOrNone()
  const reply = await draftSignalReply({
    subreddit,
    author,
    text,
    topic,
    intentType,
    voiceSamples: voice.samples,
    voiceBrief: voice.brief,
  })

  if (!reply) {
    return Response.json(
      { error: 'Claude returned no reply. Try again.' },
      { status: 502 }
    )
  }

  return Response.json({ reply })
}
