// Buying-intent phrase patterns shared between the /api/signals endpoint
// (server-side ILIKE filtering + match identification) and the client UI
// (matched-phrase highlighting). Lowercased; matched case-insensitively.

export type IntentType = 'looking-for' | 'switching' | 'willing-to-pay'

export const INTENT_TYPES: IntentType[] = ['looking-for', 'switching', 'willing-to-pay']

export const INTENT_TYPE_LABEL: Record<IntentType, string> = {
  'looking-for': 'looking for',
  switching: 'switching',
  'willing-to-pay': 'willing to pay',
}

export type Pattern = { phrase: string; intentType: IntentType }

export const INTENT_PATTERNS: Pattern[] = [
  // ── looking-for ──
  { phrase: 'looking for', intentType: 'looking-for' },
  { phrase: 'is there a tool', intentType: 'looking-for' },
  { phrase: 'is there an app', intentType: 'looking-for' },
  { phrase: 'is there any tool', intentType: 'looking-for' },
  { phrase: 'anyone know a', intentType: 'looking-for' },
  { phrase: 'anyone know of', intentType: 'looking-for' },
  { phrase: 'anyone use', intentType: 'looking-for' },
  { phrase: 'recommend a', intentType: 'looking-for' },
  { phrase: 'any recommendations', intentType: 'looking-for' },
  { phrase: 'recommendations for', intentType: 'looking-for' },
  { phrase: 'need something that', intentType: 'looking-for' },
  { phrase: 'suggestions for', intentType: 'looking-for' },
  { phrase: 'best tool for', intentType: 'looking-for' },
  { phrase: 'best app for', intentType: 'looking-for' },
  { phrase: 'what do you use for', intentType: 'looking-for' },

  // ── switching ──
  { phrase: 'switched from', intentType: 'switching' },
  { phrase: 'switching from', intentType: 'switching' },
  { phrase: 'moved to', intentType: 'switching' },
  { phrase: 'moving from', intentType: 'switching' },
  { phrase: 'alternative to', intentType: 'switching' },
  { phrase: 'alternatives to', intentType: 'switching' },
  { phrase: 'replaced with', intentType: 'switching' },
  { phrase: 'replacement for', intentType: 'switching' },

  // ── willing-to-pay ──
  { phrase: 'willing to pay', intentType: 'willing-to-pay' },
  { phrase: 'would pay', intentType: 'willing-to-pay' },
  { phrase: "i'd pay", intentType: 'willing-to-pay' },
  { phrase: 'i would pay', intentType: 'willing-to-pay' },
  { phrase: 'happy to pay', intentType: 'willing-to-pay' },
  { phrase: 'would buy', intentType: 'willing-to-pay' },
]

/**
 * Stricter phrase set for the PUBLIC demo (/api/public/scan) only. The demo skips
 * the Claude buyer-intent gate (it treats a phrase-matched non-maker post as a
 * buyer), so bare "looking for" leaks advice posts like "looking for best
 * practices". Require an article/product noun there. The main app keeps the broad
 * `INTENT_PATTERNS` (its Claude classifier recovers precision), so recall there is
 * unchanged.
 */
export const PUBLIC_INTENT_PATTERNS: Pattern[] = [
  ...INTENT_PATTERNS.filter((p) => p.phrase !== 'looking for'),
  { phrase: 'looking for a', intentType: 'looking-for' },
  { phrase: 'looking for an', intentType: 'looking-for' },
  { phrase: 'looking for some', intentType: 'looking-for' },
  { phrase: 'looking for software', intentType: 'looking-for' },
  { phrase: 'looking for tools', intentType: 'looking-for' },
]

/**
 * Negation words that flip the meaning of a following intent phrase.
 * "I'm not looking for X", "never switched from Y", "stop trying to find Z"
 * are NOT buying signals — the user is explicitly opting out.
 */
const NEGATIONS: ReadonlySet<string> = new Set(['not', 'never', 'stop'])

/**
 * How many words before the match to scan for a negation. 3 catches the
 * common adverbial patterns ("not currently looking for", "never really
 * switched from") without producing too many spurious matches in long
 * sentences where the negation isn't actually scoped to the phrase.
 */
const NEGATION_LOOKBACK_WORDS = 3

function isNegatedAt(loweredText: string, matchIdx: number): boolean {
  // Walk backward from the match, collecting up to LOOKBACK words. Cap the
  // slice at 60 chars so very long preceding text doesn't pull arbitrary
  // amounts into the word-scan.
  const start = Math.max(0, matchIdx - 60)
  const tail = loweredText.slice(start, matchIdx)
  const words = tail.match(/[a-z']+/g)
  if (!words) return false
  const recent = words.slice(-NEGATION_LOOKBACK_WORDS)
  return recent.some((w) => NEGATIONS.has(w))
}

/**
 * Find the first non-negated intent phrase that appears in `text`
 * (case-insensitive). Returns the matched pattern, or null if every
 * occurrence is preceded by a negation word. Used server-side to tag each
 * row with the specific phrase that matched, after a SQL ILIKE filter has
 * already narrowed the candidates — the negation guard here is what trims
 * the false positives that ILIKE can't filter out.
 */
export function findFirstMatch(
  text: string,
  patterns: Pattern[] = INTENT_PATTERNS,
): Pattern | null {
  const lower = text.toLowerCase()
  let earliest: { pattern: Pattern; idx: number } | null = null
  for (const p of patterns) {
    // Walk occurrences of this phrase; take the earliest non-negated one.
    let from = 0
    for (;;) {
      const i = lower.indexOf(p.phrase, from)
      if (i < 0) break
      if (!isNegatedAt(lower, i)) {
        if (!earliest || i < earliest.idx) earliest = { pattern: p, idx: i }
        break
      }
      from = i + p.phrase.length
    }
  }
  return earliest?.pattern ?? null
}

/** Pattern subset for one intent type, or the full list when 'all'. */
export function patternsFor(intent: IntentType | 'all'): Pattern[] {
  if (intent === 'all') return INTENT_PATTERNS
  return INTENT_PATTERNS.filter((p) => p.intentType === intent)
}
