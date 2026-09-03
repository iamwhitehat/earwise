// Business Memory — project-scoped facts about the founder, seeded from their
// profile and enriched over time. A compact digest is injected into every
// synthesis/strategy prompt so the output is personalized. Pure: no Supabase,
// no server-only (DB access lives in lib/memory-db.ts).
import type { BusinessProfile } from './strategy'

export const DEFAULT_PROJECT = 'default'

export type MemoryKind =
  | 'product'
  | 'value_prop'
  | 'icp'
  | 'stage'
  | 'goal'
  | 'skill'
  | 'channel'
  | 'constraint'
  | 'url'
  | 'learned'
  | 'market_pain'
  | 'incumbent'
  | 'buyer_language'
  | 'momentum'
  | 'gap'

export type MemoryFact = {
  kind: MemoryKind
  fact: string
  weight: number
}

/** Profile-derived kinds — replaced wholesale on each profile save, so
 *  re-saving doesn't accumulate duplicates. 'learned' facts are preserved. */
export const PROFILE_KINDS: MemoryKind[] = [
  'product',
  'value_prop',
  'icp',
  'stage',
  'goal',
  'skill',
  'channel',
  'constraint',
  'url',
]

function splitList(s: string): string[] {
  return s
    .split(/[,;\n]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 8)
}

/**
 * Derive memory facts from a business profile. Single-value fields become one
 * fact; skills/channels are split into one fact each so FitToYou can match
 * them individually.
 */
export function seedFactsFromProfile(p: BusinessProfile): MemoryFact[] {
  const facts: MemoryFact[] = []
  const one = (kind: MemoryKind, value: string, weight = 1) => {
    const v = value.trim()
    if (v) facts.push({ kind, fact: v.slice(0, 500), weight })
  }
  one('product', p.product)
  one('value_prop', p.valueProp)
  one('icp', p.icp, 1.5)
  one('stage', p.stage)
  one('goal', p.primaryGoal, 1.5)
  one('url', p.url)
  for (const s of splitList(p.skills)) facts.push({ kind: 'skill', fact: s.slice(0, 120), weight: 1 })
  for (const c of splitList(p.channels)) facts.push({ kind: 'channel', fact: c.slice(0, 120), weight: 1 })
  for (const c of splitList(p.constraints)) facts.push({ kind: 'constraint', fact: c.slice(0, 160), weight: 1 })
  return facts
}

const KIND_LABEL: Record<MemoryKind, string> = {
  product: 'Product',
  value_prop: 'Value prop',
  icp: 'ICP',
  stage: 'Stage',
  goal: 'Goal',
  skill: 'Skill',
  channel: 'Channel',
  constraint: 'Constraint',
  url: 'URL',
  learned: 'Learned',
  market_pain: 'Market pain',
  incumbent: 'Incumbent',
  buyer_language: 'Buyer language',
  momentum: 'Momentum',
  gap: 'Opportunity',
}

const DIGEST_MAX_FACTS = 40

/** Render facts as a compact labeled block for prompt injection. Returns ''
 *  when there are no facts (callers should then inject nothing). */
export function renderMemoryDigest(facts: MemoryFact[]): string {
  if (facts.length === 0) return ''
  const sorted = [...facts].sort((a, b) => b.weight - a.weight).slice(0, DIGEST_MAX_FACTS)
  const lines = sorted.map((f) => `- [${KIND_LABEL[f.kind] ?? f.kind}] ${f.fact}`)
  return `# ABOUT THE FOUNDER (business memory)\n${lines.join('\n')}`
}

/** Pull just the skills / ICP / channels text — used by FitToYou matching. */
export function fitText(facts: MemoryFact[]): string {
  return facts
    .filter((f) => f.kind === 'skill' || f.kind === 'icp' || f.kind === 'channel')
    .map((f) => f.fact)
    .join(' ')
}

/** The founder's offer (product + value prop) — grounds follow-up / objection
 *  drafts. '' when there's no profile yet. */
export function offerText(facts: MemoryFact[]): string {
  return facts
    .filter((f) => f.kind === 'product' || f.kind === 'value_prop')
    .map((f) => f.fact)
    .join('. ')
}
