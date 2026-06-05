// Warm Leads (handoff: WarmLeads.html) — pure helpers. Decide WHO to reach today
// with zero manual triage: hottest on top, cool ones greyed. Heat bands match
// both the handoff (≥70 / ≥40) and our own lead-score tiers (TIER_HOT 70,
// TIER_WARM 40) — so "cooling" is exactly our "warm". We score with the existing
// engine (/api/hot-signals already blends intent + recency), so no parallel
// warmth model is needed; the score IS the warmth.

export type Heat = 'hot' | 'cooling' | 'cold'

export const HEAT_GLYPH: Record<Heat, string> = { hot: '●', cooling: '◑', cold: '○' }

/** Heat band from our 0–100 lead score. */
export function heatOf(score: number): Heat {
  return score >= 70 ? 'hot' : score >= 40 ? 'cooling' : 'cold'
}

/** Human age from an epoch-ms post time (handoff ageStr). */
export function ageStr(postedAtMs: number, now: number = Date.now()): string {
  const h = (now - postedAtMs) / 3.6e6
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m ago`
  if (h < 24) return `${Math.round(h)}h ago`
  return `${Math.round(h / 24)}d ago`
}

export type PromoVerdict = { flag: boolean; reason?: string }

/**
 * Promo gate — the safety net (handoff promoGate). A client-side complement to
 * the persona's "helpful first, never a pitch": flag a drafted reply that names
 * a product unprompted, includes a link/CTA, or reads like an ad, so the founder
 * takes a second look before it goes out.
 */
export function promoGate(text: string | null | undefined): PromoVerdict {
  if (!text) return { flag: false }
  const t = text.toLowerCase()
  const rules: { re: RegExp; reason: string }[] = [
    { re: /https?:\/\/|\b[\w-]+\.(com|io|app|co|net|dev|ai)\b/, reason: 'contains a link' },
    { re: /\b(sign up|free trial|check (it|us) out|book a demo|dm me)\b/, reason: 'contains a CTA' },
    { re: /\b(we built|our tool|our product|our platform|our app)\b/, reason: 'names a product unprompted' },
  ]
  for (const r of rules) if (r.re.test(t)) return { flag: true, reason: r.reason }
  return { flag: false }
}
