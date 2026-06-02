// Buyer-intent gate (pure). Classifies the AUTHOR's role so only a GENUINE BUYER
// reaches Hot-now / Leads — makers/self-promoters and discussion/rants are
// filtered out. The Claude call + DB cache live elsewhere (lib/claude.ts,
// lib/buyer-intent-db.ts); this module stays testable (no server-only, no SDK).
import { INTENT_TYPES, type IntentType } from './intent-patterns'

export type BuyerRole = 'buyer' | 'maker' | 'discussion'
export type BuyerConfidence = 'high' | 'medium' | 'low'

export type BuyerIntentResult = {
  /** buyer = wants a solution now · maker = promoting their own thing ·
   *  discussion = answering/showcase/rant/news. */
  role: BuyerRole
  /** Only a `buyer` role is a genuine buyer. */
  isBuyer: boolean
  confidence: BuyerConfidence
  /** The buyer's intent (looking-for/switching/willing-to-pay) as judged by the
   *  classifier — preferred over the raw matched substring for the badge.
   *  null for non-buyers or when the model didn't specify. */
  intent: IntentType | null
}

export function isBuyerRole(role: BuyerRole | null | undefined): boolean {
  return role === 'buyer'
}

// The verdict string stored in the posts.buyer_intent cache column.
export type BuyerVerdict = 'buyer' | 'not_buyer'
export function verdictForRole(role: BuyerRole): BuyerVerdict {
  return role === 'buyer' ? 'buyer' : 'not_buyer'
}
export function isGenuineBuyer(verdict: BuyerVerdict | null | undefined): boolean {
  return verdict === 'buyer'
}

// ── Maker / self-promo pre-flag ──────────────────────────────────────────────
// Cheap deterministic catch for the unambiguous "I'm promoting my own thing"
// tells, so obvious makers never need a Claude call (and are testable). Anything
// not caught here still goes to the model.
const MAKER_PATTERNS: RegExp[] = [
  /\bi will not promote\b/i,
  /\bi (?:built|made|created|developed|launched|shipped)\b/i,
  /\bi'?m (?:building|launching|working on)\b/i,
  /\bwe(?:'re| are)? (?:building|launching)\b/i,
  /\bwe(?:'re| are)? looking for (?:users|feedback|beta|testers|early adopters)\b/i,
  /\blooking for (?:beta )?(?:users|testers|feedback|early adopters) for my\b/i,
  /\bcheck (?:out|this) my\b/i,
  /\bmy (?:app|tool|startup|saas|product|project|side[- ]?project)\b/i,
]

export function makerPreflag(text: string): boolean {
  return MAKER_PATTERNS.some((re) => re.test(text))
}

const CLASSIFY_TEXT_CAP = 600

/** Numbered classification input — one line per item, whitespace-collapsed and
 *  capped so a long post can't dominate the prompt. Pure + deterministic. */
export function buildBuyerIntentInput(items: { text: string }[]): string {
  return items
    .map((it, i) => `${i + 1}. ${it.text.replace(/\s+/g, ' ').trim().slice(0, CLASSIFY_TEXT_CAP)}`)
    .join('\n\n')
}

export const BUYER_INTENT_SYSTEM_PROMPT = `You classify each numbered Reddit post/comment by the AUTHOR'S role for a tool/service vendor.

role = "maker": the author is promoting, launching, showing off, or seeking users/feedback/beta/testers for THEIR OWN product, app, tool, startup, or project. Tells: "I built…", "I made…", "I'm launching…", "check out my…", "I will not promote… (but here's my thing)", "looking for beta testers". Makers are NOT buyers.

role = "buyer": the author themselves has the problem RIGHT NOW and is actively looking for, comparing, or willing to pay for a solution. Set "intent" to "looking-for" (asking for a tool/recommendation), "switching" (leaving a tool, wants an alternative), or "willing-to-pay" ("I'd pay for…"). Only this role is a buyer.

role = "discussion": everything else — answering or recommending to someone else, motivational/mindset rants, showcases, jokes, hypotheticals, news, tutorials, generic "what do you all think". A motivational rant that mentions paying is still "discussion", NOT a buyer.

Be strict. When unsure, prefer "discussion". Return one verdict per numbered item via the report_buyer_intent tool.`

function asConfidence(v: unknown): BuyerConfidence {
  return v === 'high' || v === 'medium' || v === 'low' ? v : 'medium'
}
function asRole(v: unknown): BuyerRole {
  return v === 'buyer' || v === 'maker' || v === 'discussion' ? v : 'discussion'
}
function asIntent(v: unknown): IntentType | null {
  return typeof v === 'string' && (INTENT_TYPES as readonly string[]).includes(v) ? (v as IntentType) : null
}

/**
 * Map the tool output ({ verdicts: [{ index, role, intent?, confidence }] }) onto
 * a fixed-length array aligned to input order. Tolerant: unknown shapes,
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
    const role = asRole(o.role)
    out[idx - 1] = {
      role,
      isBuyer: role === 'buyer',
      confidence: asConfidence(o.confidence),
      intent: role === 'buyer' ? asIntent(o.intent) : null,
    }
  }
  return out
}
