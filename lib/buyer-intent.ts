// Buyer-intent gate (pure). The intent-pattern match is a cheap first pass that
// still lets through non-buyers; this second pass has Haiku confirm a *genuine
// buyer* — a real person with a problem actively seeking or willing to pay for a
// solution — vs noise (answering, self-promo, jokes, venting). DB caching +
// the Claude call live elsewhere; this stays testable (no server-only, no SDK).

export type BuyerVerdict = 'buyer' | 'not_buyer'
export type BuyerConfidence = 'high' | 'medium' | 'low'
export type BuyerIntentResult = { verdict: BuyerVerdict; confidence: BuyerConfidence }

export function isGenuineBuyer(verdict: BuyerVerdict | null | undefined): boolean {
  return verdict === 'buyer'
}

// ─── Combined relevance + buyer-intent ───────────────────────────────────────
// The same Haiku pass also judges whether a signal is on-niche for the founder's
// project. A signal must be BOTH on-niche AND a genuine buyer to reach Hot-now /
// Leads. Relevance depends on the niche, so callers cache it with a nicheKey().

export type SignalVerdict = {
  buyer: BuyerVerdict
  /** On-niche for the founder's project. */
  onNiche: boolean
  confidence: BuyerConfidence
}

const NICHE_CONTEXT_CAP = 600

/** Compress the niche/profile sources into a single context string. Empty when
 *  there's nothing to judge against (→ callers skip relevance gating). Pure. */
export function buildNicheContext(parts: Array<string | null | undefined>): string {
  return parts
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean)
    .join(' · ')
    .replace(/\s+/g, ' ')
    .slice(0, NICHE_CONTEXT_CAP)
}

/** Stable short key for a niche context, so a cached on-niche verdict is only
 *  reused while the niche is unchanged. '' for an empty context. Pure (FNV-1a). */
export function nicheKey(context: string): string {
  const norm = context.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!norm) return ''
  let h = 0x811c9dc5
  for (let i = 0; i < norm.length; i++) {
    h ^= norm.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

export const SIGNAL_GATE_SYSTEM_PROMPT = `You screen Reddit posts/comments for a founder, on TWO axes at once.

1. on_niche — is this about the founder's NICHE (the space their product serves)? The founder's niche is given at the top of the user message. true only if the post is plausibly about that space / its problems / its tools. Off-topic chatter from the same subreddit is on_niche = false.

2. is_buyer — is the AUTHOR a GENUINE BUYER: a real person who has the problem now and is actively looking for, comparing, or willing to pay for a solution? true only when they themselves want a solution (asking for a tool, switching and seeking an alternative, saying they'd pay). false for: answering/recommending to someone else, promoting their own product, ranting with no intent, jokes/hypotheticals, generic discussion.

Judge each numbered item. When unsure on either axis, prefer false. Return one verdict per item via the report_signal_gate tool.`

/** Numbered input prefixed with the founder's niche. Pure. */
export function buildSignalGateInput(niche: string, items: { text: string }[]): string {
  const head = niche ? `Founder's niche: ${niche}\n\n` : ''
  return head + buildBuyerIntentInput(items)
}

/**
 * Map the combined tool output ({ verdicts: [{ index, is_buyer, on_niche,
 * confidence }] }) onto a fixed-length array aligned to input order. Tolerant.
 */
export function normalizeSignalVerdicts(raw: unknown, count: number): (SignalVerdict | null)[] {
  const out: (SignalVerdict | null)[] = new Array(count).fill(null)
  const arr = (raw as { verdicts?: unknown })?.verdicts
  if (!Array.isArray(arr)) return out
  for (const v of arr) {
    const o = (v ?? {}) as Record<string, unknown>
    const idx = Number(o.index)
    if (!Number.isInteger(idx) || idx < 1 || idx > count) continue
    if (out[idx - 1]) continue
    out[idx - 1] = {
      buyer: o.is_buyer === true ? 'buyer' : 'not_buyer',
      onNiche: o.on_niche === true,
      confidence: asConfidence(o.confidence),
    }
  }
  return out
}

export const BUYER_INTENT_SYSTEM_PROMPT = `You decide whether each numbered Reddit post/comment is a GENUINE BUYER for a software/tool/service — a real person who has the problem now and is actively looking for, comparing, or willing to pay for a solution.

Mark is_buyer = true ONLY when the author themselves wants a solution:
- asking for a tool/recommendation for their own need
- switching away from a tool and seeking an alternative
- saying they'd pay / are looking to buy

Mark is_buyer = false for everything else, including:
- answering or recommending a tool to someone else
- promoting their own product/project ("I built…", "check out my…")
- ranting/venting with no intent to find or buy a solution
- jokes, hypotheticals, or off-topic "would pay" (e.g. "I'd pay to skip this")
- generic discussion, news, tutorials, or "what do you all think"

When unsure, prefer is_buyer = false. Return one verdict per numbered item via the report_buyer_intent tool.`

const CLASSIFY_TEXT_CAP = 600

/** Numbered classification input — one line per item, whitespace-collapsed and
 *  capped so a long post can't dominate the prompt. Pure + deterministic. */
export function buildBuyerIntentInput(items: { text: string }[]): string {
  return items
    .map((it, i) => `${i + 1}. ${it.text.replace(/\s+/g, ' ').trim().slice(0, CLASSIFY_TEXT_CAP)}`)
    .join('\n\n')
}

function asConfidence(v: unknown): BuyerConfidence {
  return v === 'high' || v === 'medium' || v === 'low' ? v : 'medium'
}

/**
 * Map the tool output ({ verdicts: [{ index, is_buyer, confidence }] }) onto a
 * fixed-length array aligned to the input order. Tolerant: unknown shapes,
 * out-of-range indexes, and duplicates are ignored; unscored slots stay null.
 */
export function normalizeBuyerVerdicts(raw: unknown, count: number): (BuyerIntentResult | null)[] {
  const out: (BuyerIntentResult | null)[] = new Array(count).fill(null)
  const arr = (raw as { verdicts?: unknown })?.verdicts
  if (!Array.isArray(arr)) return out
  for (const v of arr) {
    const o = (v ?? {}) as Record<string, unknown>
    const idx = Number(o.index)
    if (!Number.isInteger(idx) || idx < 1 || idx > count) continue
    if (out[idx - 1]) continue // first verdict for an index wins
    out[idx - 1] = {
      verdict: o.is_buyer === true ? 'buyer' : 'not_buyer',
      confidence: asConfidence(o.confidence),
    }
  }
  return out
}
