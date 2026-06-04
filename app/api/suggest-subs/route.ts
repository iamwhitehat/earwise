import type { NextRequest } from 'next/server'
import { suggestSubreddits } from '@/lib/claude'

const MAX_NICHE_LEN = 100

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const { niche } = (body ?? {}) as { niche?: unknown }
  if (typeof niche !== 'string') {
    return Response.json({ error: 'niche must be a string' }, { status: 400 })
  }
  const trimmed = niche.trim()
  if (trimmed.length < 2) {
    return Response.json({ error: 'Niche too short' }, { status: 400 })
  }
  if (trimmed.length > MAX_NICHE_LEN) {
    return Response.json(
      { error: `Niche too long (max ${MAX_NICHE_LEN} chars)` },
      { status: 400 }
    )
  }

  const suggestions = await suggestSubreddits(trimmed)
  return Response.json({ suggestions })
}
