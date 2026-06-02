// Server buyer-intent gate: keep only GENUINE BUYERS, dropping makers /
// self-promoters and discussion/rants. A cheap maker pre-flag (regex) catches
// the obvious self-promo without a Claude call; the rest go to the role
// classifier (Haiku, cached on posts.buyer_intent). The classifier's intent
// (looking-for/switching/willing-to-pay) is cached on buyer_intent_type and
// used to override the raw matched-substring intentType on kept buyers, so the
// badge reflects the model's judgement. Relevance is a separate filter applied
// on top (lib/relevance-db + the combined gate in hot-signals). Tolerant of the
// unmigrated columns (degrades to pass-through) and bounded.
import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { classifyBuyerIntent } from './claude'
import { isGenuineBuyer, makerPreflag, verdictForRole, type BuyerVerdict } from './buyer-intent'
import { INTENT_TYPES, type IntentType } from './intent-patterns'
import type { SignalRow } from './signals-db'

const CLASSIFY_CAP = 60

const keyOf = (s: Pick<SignalRow, 'kind' | 'id'>): string => `${s.kind}:${s.id}`

function isBuyerVerdict(v: unknown): v is BuyerVerdict {
  return v === 'buyer' || v === 'not_buyer'
}
function asIntent(v: unknown): IntentType | null {
  return typeof v === 'string' && (INTENT_TYPES as readonly string[]).includes(v) ? (v as IntentType) : null
}

/**
 * Keep only genuine buyers. Confirmed makers / non-buyers are dropped; anything
 * not yet judged passes through so a real lead is never hidden before screening.
 * Kept buyers get their `intentType` overridden with the classifier's intent
 * when known. Relevance is layered on separately (see lib/hot-signals-db).
 */
export async function gateSignals(
  db: SupabaseClient,
  signals: SignalRow[],
  opts: { projectId?: string; classifyCap?: number } = {},
): Promise<SignalRow[]> {
  if (signals.length === 0) return signals

  const buyer = new Map<string, BuyerVerdict>()
  const intent = new Map<string, IntentType>()
  // Whether the buyer_intent_type column exists (learned from the cache read);
  // gates whether we attempt to persist it. Assume present until proven absent.
  let intentColExists = true

  // 1. Cached verdicts. A column-missing error (pre-migration) → pass-through.
  async function readCache(
    table: 'posts' | 'post_comments',
    idCol: string,
    ids: string[],
    prefix: string,
  ): Promise<boolean> {
    if (ids.length === 0) return true
    // Try verdict + classifier intent; fall back if the intent column isn't
    // migrated yet; pass-through if neither column exists. (Separate consts —
    // reassigning a typed .select() across different column strings trips the
    // PostgREST ParserError type.)
    const rich = await db.from(table).select(`${idCol}, buyer_intent, buyer_intent_type`).in(idCol, ids)
    let rows: Record<string, unknown>[]
    if (rich.error) {
      intentColExists = false
      const lean = await db.from(table).select(`${idCol}, buyer_intent`).in(idCol, ids)
      if (lean.error) return false
      rows = (lean.data ?? []) as unknown as Record<string, unknown>[]
    } else {
      rows = (rich.data ?? []) as unknown as Record<string, unknown>[]
    }
    for (const r of rows) {
      const id = r[idCol] as string
      if (isBuyerVerdict(r.buyer_intent)) buyer.set(`${prefix}:${id}`, r.buyer_intent)
      const it = asIntent(r.buyer_intent_type)
      if (it) intent.set(`${prefix}:${id}`, it)
    }
    return true
  }
  const postIds = signals.filter((s) => s.kind === 'post').map((s) => s.id)
  const commentIds = signals.filter((s) => s.kind === 'comment').map((s) => s.id)
  const okPosts = await readCache('posts', 'post_id', postIds, 'post')
  const okComments = await readCache('post_comments', 'comment_id', commentIds, 'comment')
  if (!okPosts || !okComments) return signals

  // 2. Classify uncached (maker pre-flag first → skip Claude), persist verdicts.
  const uncached = signals.filter((s) => !buyer.has(keyOf(s))).slice(0, opts.classifyCap ?? CLASSIFY_CAP)
  if (uncached.length > 0) {
    const nowIso = new Date().toISOString()
    const writes: Promise<unknown>[] = []
    const persist = (s: SignalRow, verdict: BuyerVerdict, intentType: IntentType | null) => {
      const patch: Record<string, unknown> = { buyer_intent: verdict, buyer_intent_at: nowIso }
      if (intentColExists && intentType) patch.buyer_intent_type = intentType
      writes.push(
        s.kind === 'post'
          ? Promise.resolve(db.from('posts').update(patch).eq('post_id', s.id).eq('subreddit', s.subreddit))
          : Promise.resolve(db.from('post_comments').update(patch).eq('comment_id', s.id)),
      )
    }

    const toClassify: SignalRow[] = []
    for (const s of uncached) {
      if (makerPreflag(s.text)) {
        buyer.set(keyOf(s), 'not_buyer')
        persist(s, 'not_buyer', null)
      } else {
        toClassify.push(s)
      }
    }
    if (toClassify.length > 0) {
      const results = await classifyBuyerIntent(toClassify.map((s) => ({ text: s.text })))
      toClassify.forEach((s, i) => {
        const r = results[i]
        if (!r) return
        const verdict = verdictForRole(r.role)
        buyer.set(keyOf(s), verdict)
        if (r.intent) intent.set(keyOf(s), r.intent)
        persist(s, verdict, r.intent)
      })
    }

    if (writes.length > 0) {
      try {
        await Promise.all(writes)
      } catch (err) {
        console.warn('[buyer-intent] persist skipped:', err)
      }
    }
  }

  // 3. Drop confirmed non-buyers; keep buyers + still-unjudged. Override the
  //    badge intent with the classifier's verdict where we have it.
  const kept: SignalRow[] = []
  for (const s of signals) {
    const v = buyer.get(keyOf(s))
    if (v != null && !isGenuineBuyer(v)) continue
    const it = intent.get(keyOf(s))
    kept.push(it ? { ...s, intentType: it } : s)
  }
  return kept
}
