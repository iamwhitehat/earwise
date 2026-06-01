import type { NextRequest } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { normalizeProfile, EMPTY_PROFILE } from '@/lib/strategy'
import { seedMemoryFromProfile } from '@/lib/memory-db'

const MIGRATION_HINT =
  'If a missing table is named, run the Guided strategist migration in SETUP.md (2b-terdecies).'

// GET /api/strategy/profile — latest saved business profile (or an empty one).
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
    .from('business_profile')
    .select('profile, updated_at')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[strategy] profile read error:', error)
    return Response.json(
      { error: `Database query failed: ${error.message}. ${MIGRATION_HINT}` },
      { status: 500 }
    )
  }

  if (!data) return Response.json({ profile: EMPTY_PROFILE, updatedAt: null })
  return Response.json({
    profile: normalizeProfile(data.profile),
    updatedAt: new Date(data.updated_at as string).getTime(),
  })
}

// PUT /api/strategy/profile — save the business profile (append-only history).
export async function PUT(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const profile = normalizeProfile((body as { profile?: unknown })?.profile ?? body)

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
    .from('business_profile')
    .insert({ profile })
    .select('updated_at')
    .single()

  if (error || !data) {
    console.error('[strategy] profile save error:', error)
    return Response.json(
      { error: `Database insert failed: ${error?.message ?? 'unknown'}. ${MIGRATION_HINT}` },
      { status: 500 }
    )
  }

  // Seed Business Memory from the profile (best-effort; tolerant of an
  // unmigrated business_memory table).
  await seedMemoryFromProfile(db, profile)

  return Response.json({ profile, updatedAt: new Date(data.updated_at as string).getTime() })
}
