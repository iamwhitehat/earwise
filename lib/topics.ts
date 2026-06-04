// Topic canonicalization — the cheap, deterministic pass. Pure (no Supabase,
// no Claude) so it's unit-testable and runs identically on client and server.
//
// Pipeline: lowercase + strip punctuation + collapse whitespace → per-word
// singularize → alias map → done. Two raw topics that reduce to the same
// string are treated as the same canonical topic, which kills the
// "auth problems" vs "authentication issues" fragmentation that splits trends.
//
// A heavier embedding / Balanced-model clustering pass can refine these
// groupings later (Phase 2); `canonicalizeVocabulary` already returns the
// canonical-label + member→canonical mapping such a pass would produce, so
// the storage + aggregation contract is in place now.

/** Synonym → canonical token map, applied per word AFTER singularization.
 *  Keep this conservative: only merge tokens that are genuinely
 *  interchangeable in this domain, to avoid over-collapsing distinct topics. */
const WORD_ALIASES: Record<string, string> = {
  authentication: 'auth',
  authn: 'auth',
  login: 'auth',
  signin: 'auth',
  issue: 'problem',
  bug: 'problem',
  struggle: 'problem',
  frustration: 'problem',
  pain: 'problem',
  cost: 'pricing',
  price: 'pricing',
  billing: 'pricing',
  onboard: 'onboarding',
  app: 'application',
  apps: 'application',
  dev: 'developer',
  devs: 'developer',
  config: 'configuration',
  db: 'database',
  perf: 'performance',
  ux: 'usability',
  ui: 'interface',
}

/** Phrase-level aliases applied as word-boundary substring replacements
 *  BEFORE the per-word pass, for multi-word synonyms that don't reduce
 *  token-by-token. */
const PHRASE_ALIASES: Array<[RegExp, string]> = [
  [/\bsign up\b/g, 'signup'],
  [/\blog in\b/g, 'auth'],
  [/\be mail\b/g, 'email'],
  [/\bset up\b/g, 'setup'],
]

// Words we never singularize (false plurals / domain terms ending in 's').
const SINGULAR_EXCEPTIONS = new Set([
  'analytics',
  'devops',
  'kubernetes',
  'saas',
  'cors',
  'css',
  'ios',
  'aws',
  'status',
  'business',
  'access',
  // Singular words ending in 's' that the bare-'s' rule would mangle.
  'chaos',
  'kudos',
  'lens',
  'news',
  'series',
  'species',
])

/**
 * Conservative English singularizer for a single lowercase token.
 *  - "apis" → "api", "queries"/"libraries" → "query"/"library"
 *  - "boxes"/"watches" → "box"/"watch"
 *  - "tools" → "tool"
 *  Leaves <=3-char tokens and known exceptions alone.
 */
export function singularizeWord(word: string): string {
  if (word.length <= 3) return word
  if (word === 'apis') return 'api'
  if (SINGULAR_EXCEPTIONS.has(word)) return word
  // Words ending in 'us'/'is' are almost never English plurals (virus,
  // antivirus, analysis, basis, focus, bonus, campus) — leave them whole.
  if (/(us|is)$/.test(word)) return word
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (/(ses|xes|zes|ches|shes)$/.test(word)) return word.slice(0, -2)
  if (word.endsWith('ss')) return word // address, process
  if (word.endsWith('s')) return word.slice(0, -1)
  return word
}

/** Lowercase, strip punctuation, collapse whitespace. Returns '' for junk. */
function basicNormalize(raw: string): string {
  return raw
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Canonicalize a single topic label. Deterministic and idempotent
 * (canonicalTopicLabel(canonicalTopicLabel(x)) === canonicalTopicLabel(x)).
 * Returns '' if the input has no usable content.
 */
export function canonicalTopicLabel(raw: string): string {
  let s = basicNormalize(raw)
  if (!s) return ''

  // Phrase-level aliases first (word-boundary substring replacement) so
  // multi-word synonyms collapse before per-word stemming runs.
  for (const [re, repl] of PHRASE_ALIASES) s = s.replace(re, repl)

  // Per-word: singularize then alias.
  s = s
    .split(' ')
    .map((w) => {
      const singular = singularizeWord(w)
      return WORD_ALIASES[singular] ?? singular
    })
    .join(' ')

  return s.replace(/\s+/g, ' ').trim()
}

/**
 * Null-aware convenience used at aggregation/filter sites: maps a stored
 * `topic` to its canonical form, preserving null. This is the single source
 * of truth for "which bucket does this post belong to".
 */
export function canonicalTopic(topic: string | null | undefined): string | null {
  if (!topic) return null
  const c = canonicalTopicLabel(topic)
  return c || null
}

export type VocabularyClustering = {
  /** Sorted list of distinct canonical labels. */
  canonical: string[]
  /** raw topic → canonical label. */
  mapping: Record<string, string>
}

/**
 * Cluster a vocabulary of raw topic strings into canonical groups. The
 * canonical label for a group is the most frequent original spelling (ties
 * broken by shortest, then alphabetical) so the UI shows a real human label
 * rather than the stemmed form. `counts` is optional; when omitted every
 * topic is weighted equally.
 *
 * This is the deterministic clustering pass. A future embedding/model pass
 * would produce the same shape with smarter grouping.
 */
export function canonicalizeVocabulary(
  topics: string[],
  counts?: Map<string, number>,
): VocabularyClustering {
  // group key (canonical stem) → candidate originals with weights
  const groups = new Map<string, Map<string, number>>()
  for (const raw of topics) {
    const key = canonicalTopicLabel(raw)
    if (!key) continue
    let members = groups.get(key)
    if (!members) {
      members = new Map()
      groups.set(key, members)
    }
    const w = counts?.get(raw) ?? 1
    members.set(raw, (members.get(raw) ?? 0) + w)
  }

  const mapping: Record<string, string> = {}
  const canonical: string[] = []
  for (const [, members] of groups) {
    // Pick display label: highest weight, then shortest, then alphabetical.
    const label = Array.from(members.entries()).sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1]
      if (a[0].length !== b[0].length) return a[0].length - b[0].length
      return a[0] < b[0] ? -1 : 1
    })[0][0]
    canonical.push(label)
    for (const raw of members.keys()) mapping[raw] = label
  }

  canonical.sort()
  return { canonical, mapping }
}
