// Pure logic for the "find a buyer" wedge (app/api/try/find). Splits the cheap,
// deterministic work — turning raw Reddit posts into buyer candidates, shortlisting
// the ones worth a Claude call, and ranking the confirmed buyers — out of the route
// so it stays unit-testable (no server-only, no SDK, no Supabase). The single
// Claude buyer-intent call happens in the route, between shortlist and rank.

import type { RawSignal } from './sources/types'
import { makerPreflag, type BuyerIntentResult } from './buyer-intent'
import {
  findFirstMatch,
  INTENT_TYPE_LABEL,
  type IntentType,
} from './intent-patterns'
import { scoreLead, type Tier } from './lead-score'

/** One post that survived the cheap maker pre-filter, with its intent-phrase hit. */
export type FindCandidate = {
  externalId: string
  title: string
  /** title + body, collapsed — what we classify and feed the reply. */
  text: string
  author: string
  subreddit: string
  permalink: string
  createdAt: number | null
  matchedPhrase: string | null
  patternIntent: IntentType | null
}

/** A confirmed buyer, scored + ranked, ready to show + reply to. */
export type RankedBuyer = {
  externalId: string
  title: string
  /** Fed to /api/signals/draft-reply as `text`. */
  excerpt: string
  author: string
  subreddit: string
  permalink: string
  intentType: IntentType | null
  score: number
  tier: Tier
  /** One-line "why this person" — intent + the phrase that flagged them. */
  why: string
}

const TITLE_BODY = (s: RawSignal): string => `${s.title}\n\n${s.body}`.trim()

/** How many candidates go to the single batched buyer-intent call. Keeps the
 *  Claude call cheap and fast while covering the strongest few posts. */
export const SHORTLIST_CAP = 8

/**
 * Map raw Reddit posts to candidates: drop obvious self-promo (makers) up front
 * with the deterministic pre-flag, and tag each with its earliest non-negated
 * intent phrase. Pure.
 */
export function prepareCandidates(signals: RawSignal[], subreddit: string): FindCandidate[] {
  const out: FindCandidate[] = []
  for (const s of signals) {
    const text = TITLE_BODY(s)
    if (!text || makerPreflag(text)) continue
    const match = findFirstMatch(text)
    out.push({
      externalId: s.externalId,
      title: s.title,
      text,
      author: s.author,
      subreddit,
      permalink: s.url,
      createdAt: s.createdAt,
      matchedPhrase: match?.phrase ?? null,
      patternIntent: match?.intentType ?? null,
    })
  }
  return out
}

/**
 * Pick the candidates worth spending the Claude call on: phrase-matched posts
 * first (they're the likeliest buyers), then the most recent of the rest as
 * backfill so the model can still catch buyers the phrase list misses. Pure.
 */
export function shortlistForClassification(
  candidates: FindCandidate[],
  cap = SHORTLIST_CAP,
): FindCandidate[] {
  const rank = (c: FindCandidate) => (c.matchedPhrase ? 1 : 0)
  return [...candidates]
    .sort((a, b) => rank(b) - rank(a) || (b.createdAt ?? 0) - (a.createdAt ?? 0))
    .slice(0, cap)
}

function buildWhy(intentType: IntentType | null, matchedPhrase: string | null): string {
  const label = intentType ? INTENT_TYPE_LABEL[intentType] : 'active buyer'
  return matchedPhrase ? `${label} · “${matchedPhrase}”` : label
}

/**
 * From shortlisted candidates paired with their buyer-intent verdicts, keep the
 * genuine buyers, score each (intent strength + recency), and return the top few,
 * best first. The classifier's intent wins over the raw phrase match. Pure.
 */
export function rankBuyers(
  items: { candidate: FindCandidate; verdict: BuyerIntentResult | null }[],
  opts: { now?: number; limit?: number } = {},
): RankedBuyer[] {
  const limit = opts.limit ?? 3
  return items
    .filter((it) => it.verdict?.isBuyer)
    .map(({ candidate, verdict }) => {
      const intentType = verdict?.intent ?? candidate.patternIntent ?? null
      const { score, tier } = scoreLead({
        intentType,
        postedAt: candidate.createdAt,
        now: opts.now,
      })
      return {
        buyer: {
          externalId: candidate.externalId,
          title: candidate.title,
          excerpt: candidate.text,
          author: candidate.author,
          subreddit: candidate.subreddit,
          permalink: candidate.permalink,
          intentType,
          score,
          tier,
          why: buildWhy(intentType, candidate.matchedPhrase),
        },
        createdAt: candidate.createdAt ?? 0,
      }
    })
    // Best score first; break ties by recency so a fresh buyer outranks a stale one.
    .sort((a, b) => b.buyer.score - a.buyer.score || b.createdAt - a.createdAt)
    .slice(0, limit)
    .map((x) => x.buyer)
}
