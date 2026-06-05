import type { NextRequest } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { INTENT_TYPES, type IntentType } from '@/lib/intent-patterns'
import { loadSignals, type SignalRow } from '@/lib/signals-db'
import { gateSignals } from '@/lib/buyer-intent-db'
import { activeProjectId } from '@/lib/project-server'
import { canonicalTopic } from '@/lib/topics'

const MAX_RESULTS = 100

type AgeWindow = 'all' | '24h' | 'week'

function ageMs(age: AgeWindow): number | null {
  if (age === 'all') return null
  return age === '24h' ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000
}

function isValidSub(s: string): boolean {
  return /^[a-z0-9_]{2,21}$/i.test(s)
}

export type { SignalRow }

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const sub = (url.searchParams.get('sub') ?? '').trim()
  const intentRaw = (url.searchParams.get('intent') ?? 'all').toLowerCase()
  const age = (url.searchParams.get('age') ?? 'week') as AgeWindow
  // Optional canonical-topic filter (used by the "Act on this opportunity" link
  // from Insights). Matched on the canonical form so raw-label variants resolve.
  const topicTarget = canonicalTopic((url.searchParams.get('topic') ?? '').trim())
  const intent: IntentType | 'all' = (INTENT_TYPES as string[]).includes(intentRaw)
    ? (intentRaw as IntentType)
    : 'all'

  if (sub && !isValidSub(sub)) {
    return Response.json({ error: 'Invalid subreddit' }, { status: 400 })
  }
  if (age !== 'all' && age !== '24h' && age !== 'week') {
    return Response.json({ error: 'Invalid age (use 24h, week, or all)' }, { status: 400 })
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

  let signals: SignalRow[]
  try {
    // topicTarget is filtered at the SQL level inside loadSignals so the
    // per-source cap fills from this topic's rows (not a topic-blind window).
    signals = await loadSignals(db, {
      sub: sub || undefined,
      intent,
      ageMs: ageMs(age),
      topicTarget,
    })
  } catch (err) {
    console.error('[signals] query error:', err)
    return Response.json({ error: err instanceof Error ? err.message : 'Query failed' }, { status: 500 })
  }

  // Relevance + buyer-intent gate: keep only on-niche genuine buyers
  // (pass-through pre-migration / when there's no niche).
  const gated = await gateSignals(db, signals, { projectId: await activeProjectId() })

  // Newest first (loadSignals already sorts), trim, and surface the subs present.
  const trimmed = gated.slice(0, MAX_RESULTS)
  const subs = Array.from(new Set(trimmed.map((s) => s.subreddit))).sort()

  return Response.json({ signals: trimmed, subs })
}
