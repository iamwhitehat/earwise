// Objection→response library (Convert #3). Pure + tested. Builds a ranked list
// of the objections a market actually voices — sourced from switching/hate
// quotes (people leaving an incumbent ARE stating their objections) — so the
// composer can surface a tailored response.

export type ObjectionType = 'switching' | 'hate' | 'other'

export type RawQuote = { text: string; type?: string | null }

export type ObjectionEntry = {
  objection: string
  type: ObjectionType
  count: number
}

// Quote types that signal an objection to an incumbent / the status quo.
const SWITCHING_TYPES = new Set(['switched', 'switching', 'moved', 'alternative'])
const HATE_TYPES = new Set(['hate', 'complaint', 'tool_complaint', 'frustration'])

function classify(type: string | null | undefined): ObjectionType | null {
  if (!type) return 'other'
  const t = type.toLowerCase()
  if (SWITCHING_TYPES.has(t)) return 'switching'
  if (HATE_TYPES.has(t)) return 'hate'
  return null // a typed quote that isn't an objection signal (e.g. would_pay) is excluded
}

function norm(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase()
}

const MIN_LEN = 8
const MAX_LEN = 200

/**
 * Build the objection library. Quotes carrying an objection type (switching /
 * hate) are kept; untyped quotes are treated as generic ("other") candidates.
 * Deduped by normalized text, counted, ranked by frequency then brevity.
 */
export function buildObjectionLibrary(quotes: RawQuote[], limit = 8): ObjectionEntry[] {
  const byKey = new Map<string, ObjectionEntry>()
  for (const q of quotes) {
    const text = (q.text ?? '').trim().slice(0, MAX_LEN)
    if (text.length < MIN_LEN) continue
    const type = classify(q.type)
    if (type === null) continue
    const key = norm(text)
    const existing = byKey.get(key)
    if (existing) {
      existing.count++
      // Prefer a more specific type if a later duplicate carries one.
      if (existing.type === 'other' && type !== 'other') existing.type = type
    } else {
      byKey.set(key, { objection: text, type, count: 1 })
    }
  }
  return [...byKey.values()]
    .sort((a, b) => b.count - a.count || a.objection.length - b.objection.length)
    .slice(0, limit)
}
