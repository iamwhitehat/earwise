// Optional embeddings provider for topic clustering / dedup / cross-source
// matching (Phase 1+). Cheap by default (Voyage's small model) and entirely
// optional: with no EMBEDDINGS_API_KEY set, every function no-ops (returns
// null) so callers transparently fall back to their deterministic paths.
//
// server-only: the key is read here and must never reach the browser. Nothing
// client-side imports this module.
import 'server-only'

// OpenAI-compatible request/response shape (Voyage, OpenAI, and most others
// follow it: POST { input, model } -> { data: [{ embedding: number[] }] }).
const DEFAULT_URL = 'https://api.voyageai.com/v1/embeddings'
const DEFAULT_MODEL = 'voyage-3-lite'

function apiKey(): string | null {
  const key = process.env.EMBEDDINGS_API_KEY
  if (!key || key.includes('REPLACE_WITH_YOUR')) return null
  return key
}

/** True when an embeddings key is configured. Callers can branch on this to
 *  pick the embedding path vs. the deterministic fallback. */
export function isEmbeddingsConfigured(): boolean {
  return apiKey() !== null
}

function isNumberArray(v: unknown): v is number[] {
  return Array.isArray(v) && v.every((n) => typeof n === 'number')
}

/**
 * Embed a batch of texts. Returns one vector per input (order preserved), or
 * null when embeddings aren't configured or the request fails — callers must
 * treat null as "no embeddings available" and degrade gracefully.
 */
export async function embedTexts(texts: string[]): Promise<number[][] | null> {
  const key = apiKey()
  if (!key) return null
  if (texts.length === 0) return []

  const url = process.env.EMBEDDINGS_URL || DEFAULT_URL
  const model = process.env.EMBEDDINGS_MODEL || DEFAULT_MODEL

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ input: texts, model }),
    })
    if (!res.ok) {
      console.warn(`[embeddings] request failed: ${res.status}`)
      return null
    }
    const json = (await res.json()) as { data?: Array<{ embedding?: unknown }> }
    const data = json?.data
    if (!Array.isArray(data) || data.length !== texts.length) {
      console.warn('[embeddings] unexpected response shape')
      return null
    }
    const out: number[][] = []
    for (const d of data) {
      if (!isNumberArray(d.embedding)) return null
      out.push(d.embedding)
    }
    return out
  } catch (err) {
    console.warn('[embeddings] request error:', err)
    return null
  }
}

/** Embed a single text. null when unavailable. */
export async function embedText(text: string): Promise<number[] | null> {
  const result = await embedTexts([text])
  return result ? (result[0] ?? null) : null
}

/** Cosine similarity of two equal-length vectors. Returns 0 for mismatched or
 *  zero-magnitude vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0
  let dot = 0
  let magA = 0
  let magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  if (magA === 0 || magB === 0) return 0
  return dot / (Math.sqrt(magA) * Math.sqrt(magB))
}
