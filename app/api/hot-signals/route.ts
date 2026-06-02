import type { NextRequest } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { loadHotSignals } from '@/lib/hot-signals-db'
import { activeProjectId } from '@/lib/project-server'

const WINDOWS: Record<string, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '48h': 48 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
}
const DEFAULT_WINDOW = '24h'
const LIMIT = 20

// GET /api/hot-signals?window=24h — the Hot-now feed: recent high-intent signals
// scored by Lead Score, freshest × hottest first. Tolerant: empty on any error.
export async function GET(req: NextRequest) {
  const windowParam = new URL(req.url).searchParams.get('window') ?? DEFAULT_WINDOW
  const windowMs = WINDOWS[windowParam] ?? WINDOWS[DEFAULT_WINDOW]

  let db
  try {
    db = getSupabase()
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Configuration error' },
      { status: 500 }
    )
  }

  try {
    const signals = await loadHotSignals(db, {
      windowMs,
      projectId: await activeProjectId(),
      limit: LIMIT,
    })
    return Response.json({ signals, window: windowParam })
  } catch (err) {
    console.warn('[hot-signals] failed:', err)
    return Response.json({ signals: [], window: windowParam })
  }
}
