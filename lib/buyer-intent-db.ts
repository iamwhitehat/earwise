// Server gate: filter intent-matched signals down to genuine buyers, caching
// each verdict on the posts/post_comments rows. Tolerant of the unmigrated
// columns (degrades to pass-through) and bounded so a load never fans out into
// an unbounded number of Claude calls.
import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { classifyBuyerIntent } from './claude'
import { isGenuineBuyer, type BuyerVerdict } from './buyer-intent'
import type { SignalRow } from './signals-db'

// Max uncached signals classified per request. Fresh items beyond this pass
// through unclassified and get caught on a later load.
const CLASSIFY_CAP = 60

const keyOf = (s: Pick<SignalRow, 'kind' | 'id'>): string => `${s.kind}:${s.id}`

function isBuyerVerdict(v: unknown): v is BuyerVerdict {
  return v === 'buyer' || v === 'not_buyer'
}

/**
 * Keep only genuine buyers. Reads cached verdicts, classifies a bounded batch of
 * the uncached ones (persisting results), then drops confirmed non-buyers. Rows
 * with no verdict yet (unmigrated columns, or beyond the classify budget) pass
 * through so a real buyer is never hidden before it's been judged.
 */
export async function gateSignals(
  db: SupabaseClient,
  signals: SignalRow[],
  opts: { classifyCap?: number } = {},
): Promise<SignalRow[]> {
  if (signals.length === 0) return signals

  const verdicts = new Map<string, BuyerVerdict>()

  // 1. Cached verdicts. A column-missing error (pre-migration) → pass-through.
  const postIds = signals.filter((s) => s.kind === 'post').map((s) => s.id)
  const commentIds = signals.filter((s) => s.kind === 'comment').map((s) => s.id)

  if (postIds.length > 0) {
    const { data, error } = await db.from('posts').select('post_id, buyer_intent').in('post_id', postIds)
    if (error) return signals
    for (const r of data ?? []) {
      if (isBuyerVerdict(r.buyer_intent)) verdicts.set(`post:${r.post_id as string}`, r.buyer_intent)
    }
  }
  if (commentIds.length > 0) {
    const { data, error } = await db.from('post_comments').select('comment_id, buyer_intent').in('comment_id', commentIds)
    if (error) return signals
    for (const r of data ?? []) {
      if (isBuyerVerdict(r.buyer_intent)) verdicts.set(`comment:${r.comment_id as string}`, r.buyer_intent)
    }
  }

  // 2. Classify the uncached (bounded), persist, and fill the map.
  const uncached = signals.filter((s) => !verdicts.has(keyOf(s))).slice(0, opts.classifyCap ?? CLASSIFY_CAP)
  if (uncached.length > 0) {
    const results = await classifyBuyerIntent(uncached.map((s) => ({ text: s.text })))
    const nowIso = new Date().toISOString()
    const writes: Promise<unknown>[] = []
    uncached.forEach((s, i) => {
      const r = results[i]
      if (!r) return
      verdicts.set(keyOf(s), r.verdict)
      const patch = { buyer_intent: r.verdict, buyer_intent_at: nowIso }
      writes.push(
        s.kind === 'post'
          ? Promise.resolve(db.from('posts').update(patch).eq('post_id', s.id).eq('subreddit', s.subreddit))
          : Promise.resolve(db.from('post_comments').update(patch).eq('comment_id', s.id)),
      )
    })
    if (writes.length > 0) {
      try {
        await Promise.all(writes)
      } catch (err) {
        console.warn('[buyer-intent] persist skipped:', err)
      }
    }
  }

  // 3. Drop confirmed non-buyers; keep buyers + still-unjudged.
  return signals.filter((s) => {
    const v = verdicts.get(keyOf(s))
    return v == null ? true : isGenuineBuyer(v)
  })
}
