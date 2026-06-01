import type { NextRequest } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { resolveSynthModel } from '@/lib/claude'
import { buildDigest } from '@/lib/digest'

// POST /api/digest/run — user-initiated digest generation from current data.
// Body: { tier? }. (The scheduled job at /api/cron/run also scans + re-
// synthesizes before building the digest.)
export async function POST(req: NextRequest) {
  let body: unknown = {}
  try {
    body = (await req.json()) ?? {}
  } catch {
    body = {}
  }
  const model = resolveSynthModel((body as { tier?: unknown }).tier)

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
    const brief = await buildDigest(db, { model })
    return Response.json({ brief })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Digest build failed'
    console.error('[digest/run] error:', err)
    return Response.json(
      {
        error: `${message}. If a missing table is named, run the digests migration in SETUP.md (2b-sexdecies).`,
      },
      { status: 500 }
    )
  }
}
