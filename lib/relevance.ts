// Relevance / ICP gate (pure). "Is this signal about MY niche, and is the author
// a potential customer for MY product?" Primary path is embedding cosine between
// the signal and a project-niche vector (lib/relevance-db); the fallback is a
// cheap Haiku yes/no. Relevance is per-project and computed at query time — it
// is never baked onto the post as a single global value. This module holds the
// deterministic, testable bits.

export type Relevance = { score: number; reason: string }

/** Default qualifying threshold (cosine / score). Tunable; the gate reads it. */
export const DEFAULT_RELEVANCE_TAU = 0.6

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)

/** Map a cosine similarity to a 0..1 relevance score. */
export function relevanceFromCosine(cosine: number): number {
  return clamp01(cosine)
}

/** Map a yes/no Haiku verdict to a score that lands clearly above/below τ. */
export function relevanceFromVerdict(relevant: boolean): number {
  return relevant ? 0.85 : 0.15
}

export function qualifiesRelevance(score: number, tau: number = DEFAULT_RELEVANCE_TAU): boolean {
  return score >= tau
}

const NICHE_TEXT_CAP = 800

/** Assemble the project-niche text to embed / prompt with, from its niche,
 *  product/value-prop/ICP, and its top opportunity topics. Pure. */
export function buildNicheText(parts: Array<string | null | undefined>): string {
  return parts
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean)
    .join('. ')
    .replace(/\s+/g, ' ')
    .slice(0, NICHE_TEXT_CAP)
}

// ── Haiku fallback (no embeddings key) ───────────────────────────────────────
export const RELEVANCE_SYSTEM_PROMPT = `You screen Reddit posts/comments for a founder. The founder's niche + product is given at the top of the user message.

For each numbered item decide: is it about that niche AND is the author a plausible potential CUSTOMER for that product? Set relevant=true only when both hold. A post that's a real buyer but for a DIFFERENT space (e.g. sock manufacturing, conference-room AV, banking signatures) is relevant=false. Give a short reason. When unsure, prefer relevant=false. Return one verdict per item via the report_relevance tool.`

const TEXT_CAP = 500

export function buildRelevanceInput(niche: string, items: { text: string }[]): string {
  const head = `Founder's niche + product: ${niche}\n\n`
  return (
    head +
    items.map((it, i) => `${i + 1}. ${it.text.replace(/\s+/g, ' ').trim().slice(0, TEXT_CAP)}`).join('\n\n')
  )
}

export function normalizeRelevanceVerdicts(
  raw: unknown,
  count: number,
): ({ relevant: boolean; reason: string } | null)[] {
  const out: ({ relevant: boolean; reason: string } | null)[] = new Array(count).fill(null)
  const arr = (raw as { verdicts?: unknown })?.verdicts
  if (!Array.isArray(arr)) return out
  for (const v of arr) {
    const o = (v ?? {}) as Record<string, unknown>
    const idx = Number(o.index)
    if (!Number.isInteger(idx) || idx < 1 || idx > count) continue
    if (out[idx - 1]) continue
    out[idx - 1] = {
      relevant: o.relevant === true,
      reason: typeof o.reason === 'string' ? o.reason.slice(0, 160) : '',
    }
  }
  return out
}
