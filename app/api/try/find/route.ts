import type { NextRequest } from 'next/server'
import { redditConnector } from '@/lib/sources/reddit'
import { classifyBuyerIntent } from '@/lib/claude'
import {
  prepareCandidates,
  shortlistForClassification,
  rankBuyers,
} from '@/lib/try-find'

// POST /api/try/find — the wedge's "find a buyer" step. Given a subreddit, fetch
// recent posts (RSS, no Claude), drop self-promo + shortlist the likeliest buyers
// (pure), confirm with ONE batched buyer-intent call, score + rank, and return the
// top few. Stateless — no DB. Returns { buyers: [] } (never an error) when nothing
// qualifies, so the UI falls back to paste-a-post instead of showing a failure.

const MAX_INPUT = 40

function cleanSub(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.trim().replace(/^\/?r\//i, '').replace(/\s+/g, '').slice(0, MAX_INPUT)
}

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const subreddit = cleanSub((body as { subreddit?: unknown })?.subreddit)
  if (!subreddit) {
    return Response.json({ error: 'Missing subreddit' }, { status: 400 })
  }

  try {
    // 1. Fetch (returns [] on a bad/empty/unreachable sub — never throws).
    const raw = await redditConnector.search(subreddit, req.signal)
    if (raw.length === 0) {
      return Response.json({ buyers: [], subreddit, reason: 'no_posts' })
    }

    // 2. Cheap pre-filter + shortlist (pure, no Claude).
    const candidates = prepareCandidates(raw, subreddit)
    const shortlist = shortlistForClassification(candidates)
    if (shortlist.length === 0) {
      return Response.json({ buyers: [], subreddit, reason: 'no_candidates' })
    }

    // 3. One batched buyer-intent call → confirm genuine buyers.
    const verdicts = await classifyBuyerIntent(shortlist.map((c) => ({ text: c.text })))

    // 4. Score + rank; return the top few with evidence.
    const buyers = rankBuyers(
      shortlist.map((candidate, i) => ({ candidate, verdict: verdicts[i] ?? null })),
    )

    return Response.json({ buyers, subreddit, scanned: candidates.length })
  } catch (err) {
    console.error('[try/find] error:', err)
    return Response.json({ error: 'Find failed. Try again.' }, { status: 502 })
  }
}
