// Knowledge Agent — pure helpers.
//
// The Knowledge Agent is the "rewatch and organize" layer: it re-reads the
// accumulated market intelligence on a schedule and distills only the KNOWLEDGE
// WORTH HAVING — durable, categorized facts a founder can actually use (what to
// build, how to position, how to talk to buyers) — into business_memory, where
// it compounds instead of duplicating.
//
// This module is the pure, testable half (types, normalization, dedup, clamps).
// The Claude + Supabase orchestration lives in lib/knowledge-agent.ts, mirroring
// the memory.ts / memory-db.ts split.

import type { MemoryFact } from './memory'

/** What kind of durable knowledge a curated fact is. Each maps to a decision a
 *  founder makes: build (pain/gap), position (incumbent), talk (language), time
 *  (momentum). */
export type CuratedKind = 'market_pain' | 'incumbent' | 'buyer_language' | 'momentum' | 'gap'

export const CURATED_KINDS: readonly CuratedKind[] = [
  'market_pain',
  'incumbent',
  'buyer_language',
  'momentum',
  'gap',
] as const

export type CuratedFact = {
  kind: CuratedKind
  fact: string
  weight: number
  evidence?: string
}

/** Collapse whitespace so two differently-spaced phrasings of the same fact
 *  fingerprint the same (dedup works on this). */
export function normalizeFact(fact: string): string {
  return fact.replace(/\s+/g, ' ').trim()
}

/** A stable, cheap identity for a fact. Dedup is exact-on-normalized-prefix:
 *  cheap, and the agent's fact sentences are short enough that a 72-char prefix
 *  is effectively unique. */
export function factFingerprint(fact: string): string {
  const n = normalizeFact(fact).toLowerCase()
  return n.length > 72 ? n.slice(0, 72) : n
}

/** Drop candidates that already exist in memory (and within the batch itself).
 *  This is what makes the agent *learn*: a rewatch re-derives the same fact and
 *  it is silently skipped instead of accumulating duplicates. */
export function dedupeFacts(candidates: CuratedFact[], existing: MemoryFact[]): CuratedFact[] {
  const seen = new Set(existing.map((e) => factFingerprint(e.fact)))
  return candidates.filter((c) => {
    const fp = factFingerprint(c.fact)
    if (seen.has(fp)) return false
    seen.add(fp)
    return true
  })
}

/** Defensive normalizer for raw model output: clamps enums, lengths and weights
 *  so a malformed tool result can never write a bad row. Returns highest-weight
 *  first, capped. */
export function normalizeCuratedFacts(raw: unknown): CuratedFact[] {
  const items = Array.isArray(raw) ? raw : []
  const out: CuratedFact[] = []
  for (const it of items) {
    if (!it || typeof it !== 'object') continue
    const o = it as Record<string, unknown>
    const kind = o.kind as CuratedKind
    const fact = typeof o.fact === 'string' ? normalizeFact(o.fact) : ''
    if (!fact || !(CURATED_KINDS as readonly string[]).includes(kind)) continue
    const weight =
      typeof o.weight === 'number' && Number.isFinite(o.weight)
        ? Math.min(2, Math.max(0.5, o.weight))
        : 1
    const evidence =
      typeof o.evidence === 'string' && o.evidence.trim() ? o.evidence.slice(0, 300) : undefined
    out.push({ kind, fact: fact.slice(0, 500), weight, evidence })
  }
  return out.sort((a, b) => b.weight - a.weight).slice(0, 25)
}
