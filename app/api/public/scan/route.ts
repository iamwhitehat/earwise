import type { NextRequest } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { redditConnector } from '@/lib/sources/reddit'
import { suggestSubreddits, draftSignalReply, PRIORITY } from '@/lib/claude'
import { selectPublicBuyers } from '@/lib/public-scan'
import { checkAndIncrement } from '@/lib/ip-rate-limit-db'
import { clientIp } from '@/lib/ip-rate-limit'

// POST /api/public/scan — the no-signup top-of-funnel. Given a niche: suggest
// subreddits (1 Haiku call), fetch their recent posts (RSS, no DB/Claude),
// select buyers by intent-phrase match (pure, no Claude), and draft ONE reply
// in-voice (1 Haiku call). Ungated (allow-listed in proxy.ts) but strictly
// per-IP rate-limited. No DB writes except the rate-limit counter.

const MAX_NICHE = 80
const SUBS_TO_FETCH = 2
const SHOW = 3
const EXCERPT_MAX = 420

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const rawNiche = (body as { niche?: unknown })?.niche
  const niche = typeof rawNiche === 'string' ? rawNiche.trim().slice(0, MAX_NICHE) : ''
  if (niche.length < 2) {
    return Response.json({ error: 'Enter your niche (a few words).' }, { status: 400 })
  }

  let db
  try {
    db = getSupabase()
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Configuration error' },
      { status: 500 },
    )
  }

  // Rate limit BEFORE spending any Claude tokens. Fail-open on DB issues.
  const gate = await checkAndIncrement(db, clientIp(req.headers))
  if (!gate.allowed) {
    return Response.json(
      {
        error:
          gate.reason === 'global'
            ? 'This free demo has hit its daily limit — sign up to keep scanning.'
            : "You've used your free scans for today. Sign up free to keep going.",
      },
      { status: 429 },
    )
  }

  try {
    // 1. niche → subreddits (1 Haiku call); take the top 1-2. PRIORITY.PUBLIC so
    //    anonymous traffic always yields to the owner's own Claude work.
    const subs = (await suggestSubreddits(niche, PRIORITY.PUBLIC)).slice(0, SUBS_TO_FETCH)
    if (subs.length === 0) {
      return Response.json({ buyers: [], lockedCount: 0, reply: null, subs: [], reason: 'no_subs' })
    }

    // 2. Fetch each sub's recent posts (RSS — no DB, no Claude), in parallel.
    const bySub = await Promise.all(
      subs.map(async (subreddit) => ({
        subreddit,
        raw: await redditConnector.search(subreddit, req.signal),
      })),
    )

    // 3. Select buyers (pure, no Claude).
    const { buyers, totalBuyers } = selectPublicBuyers(bySub, { limit: SHOW })
    if (buyers.length === 0) {
      return Response.json({ buyers: [], lockedCount: 0, reply: null, subs, reason: 'no_buyers' })
    }

    // 4. Draft ONE in-voice reply for the top buyer (1 Haiku call; persona rules,
    //    no saved voice/project needed).
    const top = buyers[0]
    const reply = await draftSignalReply({
      subreddit: top.subreddit,
      author: top.author,
      text: top.excerpt,
      intentType: top.intentType ?? undefined,
      priority: PRIORITY.PUBLIC,
      isPublic: true, // short, blunt demo reply
    })

    const shaped = buyers.map((b) => ({
      author: b.author,
      subreddit: b.subreddit,
      permalink: b.permalink,
      why: b.why,
      tier: b.tier,
      excerpt: b.excerpt.length > EXCERPT_MAX ? `${b.excerpt.slice(0, EXCERPT_MAX)}…` : b.excerpt,
    }))
    return Response.json({
      buyers: shaped,
      lockedCount: Math.max(0, totalBuyers - shaped.length),
      reply,
      subs,
    })
  } catch (err) {
    console.error('[public/scan] error:', err)
    return Response.json({ error: 'Scan failed. Try again.' }, { status: 502 })
  }
}
