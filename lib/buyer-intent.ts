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
