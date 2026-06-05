// Pure buyer selection for the public, no-signup instant scan (/api/public/scan).
// Reuses the wedge's tested ranking (lib/try-find) but skips the buyer-intent
// Claude call: a phrase-matched, non-maker post is treated as a buyer. That keeps
// a public scan to ~2 Haiku calls (niche→subs + one drafted reply), cheap enough
// to expose behind a strict rate limit. No server-only / SDK / Supabase here.
import { prepareCandidates, rankBuyers, type RankedBuyer } from './try-find'
import { PUBLIC_INTENT_PATTERNS } from './intent-patterns'
import type { RawSignal } from './sources/types'
import type { BuyerIntentResult } from './buyer-intent'

export type PublicScanSelection = {
  /** Top-N buyers to show (best first). */
  buyers: RankedBuyer[]
  /** Total phrase-matched buyers found across all subs (for the "N more" lock). */
  totalBuyers: number
}

/**
 * Select the buyers to surface from raw posts fetched per subreddit. Phrase-matched
 * (and non-maker, via prepareCandidates' pre-flag) posts count as buyers; they're
 * scored + ranked by the shared try-find logic. Pure + deterministic when `now` is
 * provided.
 */
export function selectPublicBuyers(
  bySub: Array<{ raw: RawSignal[]; subreddit: string }>,
  opts: { now?: number; limit?: number } = {},
): PublicScanSelection {
  // Strict phrase set: the public demo has no Claude buyer-intent gate, so require
  // article/product context to keep advice posts out (see PUBLIC_INTENT_PATTERNS).
  const candidates = bySub.flatMap(({ raw, subreddit }) =>
    prepareCandidates(raw, subreddit, PUBLIC_INTENT_PATTERNS),
  )
  const buyerItems = candidates
    .filter((c) => c.matchedPhrase != null)
    .map((candidate) => ({
      candidate,
      verdict: {
        role: 'buyer',
        isBuyer: true,
        confidence: 'medium',
        intent: candidate.patternIntent,
      } satisfies BuyerIntentResult,
    }))
  const limit = opts.limit ?? 3
  // Rank a wider pool, then prefer genuine warm/hot buyers so the public demo
  // doesn't lead with a stale/low-intent match. Fall back to the strongest
  // available if a (real but quiet) niche has nothing warm — better one modest
  // buyer than an empty demo.
  const ranked = rankBuyers(buyerItems, { now: opts.now, limit: Math.max(limit, 12) })
  const strong = ranked.filter((b) => b.tier !== 'cold')
  const buyers = (strong.length > 0 ? strong : ranked).slice(0, limit)
  return { buyers, totalBuyers: buyerItems.length }
}
