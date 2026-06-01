// Pure parsing/normalizing for the bulk classifier + topic extractor. Split
// out of lib/claude.ts (which is server-only) so the logic is unit-testable.
import { CATEGORY_ORDER, type Category } from './categories'

export type Confidence = 'high' | 'medium' | 'low'

const VALID_CATEGORY: ReadonlySet<Category> = new Set(CATEGORY_ORDER)
const VALID_CONFIDENCE: ReadonlySet<Confidence> = new Set(['high', 'medium', 'low'])

export type Classification = { category: Category; confidence: Confidence }

/**
 * Parse the classifier's JSON reply into a validated Classification. Tolerant:
 * tries the raw text, then the first {...} block, and falls back to a safe
 * default ('other'/'medium') on anything unparseable.
 */
export function parseClassification(text: string): Classification {
  const tryParse = (raw: string): Classification | null => {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (typeof parsed !== 'object' || parsed === null) return null
      const obj = parsed as Record<string, unknown>
      const cat = typeof obj.category === 'string' ? (obj.category.trim().toLowerCase() as Category) : null
      const conf = typeof obj.confidence === 'string' ? (obj.confidence.trim().toLowerCase() as Confidence) : null
      const category = cat && VALID_CATEGORY.has(cat) ? cat : 'other'
      const confidence = conf && VALID_CONFIDENCE.has(conf) ? conf : 'medium'
      return { category, confidence }
    } catch {
      return null
    }
  }
  const direct = tryParse(text.trim())
  if (direct) return direct
  const m = text.match(/\{[\s\S]*\}/)
  if (m) {
    const obj = tryParse(m[0])
    if (obj) return obj
  }
  return { category: 'other', confidence: 'medium' }
}

/**
 * Normalize a model-produced topic label: lowercase, strip punctuation,
 * collapse whitespace. Returns null if it isn't a usable 1–6 word, <=60 char
 * label. (This is the per-extraction normalizer; canonicalization for
 * aggregation lives in lib/topics.ts.)
 */
export function normalizeTopic(raw: string): string | null {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[.,;:!?'"`()[\]{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return null
  const words = cleaned.split(' ')
  if (words.length < 1 || words.length > 6) return null
  if (cleaned.length > 60) return null
  return cleaned
}
