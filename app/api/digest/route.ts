import { getSupabase } from '@/lib/supabase'
import type { StoredDigest } from '@/lib/digest-types'

// GET /api/digest — the most recent digest, or null if none yet.
export async function GET() {
  let db
  try {
    db = getSupabase()
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Configuration error' },
      { status: 500 }
    )
  }

  const { data, error } = await db
    .from('digests')
    .select('id, period, brief, created_at')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.warn('[digest] read failed:', error.message)
    return Response.json(null)
  }
  if (!data) return Response.json(null)

  const out: StoredDigest = {
    id: data.id as number,
    period: data.period as string,
    brief: data.brief as StoredDigest['brief'],
    generatedAt: new Date(data.created_at as string).getTime(),
  }
  return Response.json(out)
}
