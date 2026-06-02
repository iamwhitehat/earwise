import type { NextRequest } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { loadHotSignals, lastScanAt, hotNowWindowMs, hotNowWindowHours } from '@/lib/hot-signals-db'
import { activeProjectId } from '@/lib/project-server'

// Explicit named windows still work via ?window=; with no param the lane uses
// the tight env-tunable default (HOT_NOW_WINDOW_HOURS, default 6h) so it shows
// fresh demand, not stale 20h rows.
const WINDOWS: Record<string, number> = {
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '48h': 48 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
}
const LIMIT = 20

// GET /api/hot-signals?window=6h — the Hot-now feed: recent high-intent signals
// scored by Lead Score, freshest × hottest first. Tolerant: empty on any error.
export async function GET(req: NextRequest) {
  const windowParam = new URL(req.url).searchParams.get('window')
  const windowMs = windowParam && WINDOWS[windowParam] ? WINDOWS[windowParam] : hotNowWindowMs()
  const windowLabel = windowParam && WINDOWS[windowParam] ? windowParam : `${hotNowWindowHours()}h`

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
    const projectId = await activeProjectId()
    const [signals, scannedAt] = await Promise.all([
      loadHotSignals(db, { windowMs, projectId, limit: LIMIT }),
      lastScanAt(db),
    ])
    return Response.json({ signals, window: windowLabel, scannedAt })
  } catch (err) {
    console.warn('[hot-signals] failed:', err)
    return Response.json({ signals: [], window: windowLabel, scannedAt: null })
  }
}
