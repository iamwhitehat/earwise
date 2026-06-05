// Pure parsing/normalizing for the bulk classifier + topic extractor. Split
// out of lib/claude.ts (which is server-only) so the logic is unit-testable.
import { CATEGORY_ORDER, type Category } from './categories'

export type Confidence = 'high' | 'medium' | 'low'

const VALID_CATEGORY: ReadonlySet<Category> = new Set(CATEGORY_ORDER)
const VALID_CONFIDENCE: ReadonlySet<Confidence> = new Set(['high', 'medium', 'low'])

export type Classification = { category: Category; confidence: Confidence }

/** A classification plus the extracted topic label (null for 'other' / no clear topic). */
export type ClassifiedTopic = Classification & { topic: string | null }

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
 * Validate the structured result of the combined classify+topic tool call.
 * Same defaults as parseClassification ('other'/'medium'); the topic is
 * normalized via normalizeTopic and forced to null when the category is
 * 'other'. Tolerant of null/garbage input (returns the safe default), so it
 * mirrors the old two-call fallback behavior exactly.
 */
export function normalizeClassifyExtract(raw: unknown): ClassifiedTopic {
  const obj = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const cat = typeof obj.category === 'string' ? (obj.category.trim().toLowerCase() as Category) : null
  const conf = typeof obj.confidence === 'string' ? (obj.confidence.trim().toLowerCase() as Confidence) : null
  const category = cat && VALID_CATEGORY.has(cat) ? cat : 'other'
  const confidence = conf && VALID_CONFIDENCE.has(conf) ? conf : 'medium'
  const topic = category === 'other' ? null : normalizeTopic(typeof obj.topic === 'string' ? obj.topic : '')
  return { category, confidence, topic }
}

/** Coerce a tool-supplied index (number or numeric string) to an integer, or NaN. */
function toIndex(raw: unknown): number {
  if (typeof raw === 'number') return Number.isInteger(raw) ? raw : NaN
  if (typeof raw === 'string') {
    const n = Number.parseInt(raw, 10)
    return Number.isNaN(n) ? NaN : n
  }
  return NaN
}

const DEFAULT_CLASSIFIED: ClassifiedTopic = { category: 'other', confidence: 'medium', topic: null }

/**
 * Validate the result of the BATCH classify+topic tool call. Always returns an
 * array of exactly `count` entries, ordered by post position. Each returned
 * item carries a 1-based `index`; we place it at `index - 1`. Any post the model
 * omits, duplicates, or mis-indexes keeps the safe default (other/medium/null),
 * so a partial or scrambled response can never shift a classification onto the
 * wrong post. Tolerant of null/garbage input.
 */
export function normalizeClassifyExtractBatch(raw: unknown, count: number): ClassifiedTopic[] {
  const out: ClassifiedTopic[] = Array.from({ length: count }, () => ({ ...DEFAULT_CLASSIFIED }))
  const obj = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const list = Array.isArray(obj.classifications) ? obj.classifications : []
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue
    const n = toIndex((item as Record<string, unknown>).index)
    if (!Number.isInteger(n) || n < 1 || n > count) continue
    out[n - 1] = normalizeClassifyExtract(item)
  }
  return out
}

/**
 * Validate the result of the BATCH topic-only tool call (used for backfilling
 * topics onto already-classified posts). Returns an array of exactly `count`
 * entries; omitted/invalid indices stay null. Mirrors normalizeClassifyExtractBatch's
 * index-safety so topics can never land on the wrong post.
 */
export function normalizeTopicsBatch(raw: unknown, count: number): (string | null)[] {
  const out: (string | null)[] = Array.from({ length: count }, () => null)
  const obj = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const list = Array.isArray(obj.topics) ? obj.topics : []
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue
    const rec = item as Record<string, unknown>
    const n = toIndex(rec.index)
    if (!Number.isInteger(n) || n < 1 || n > count) continue
    out[n - 1] = normalizeTopic(typeof rec.topic === 'string' ? rec.topic : '')
  }
  return out
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
