// Scan core — collect → classify → score → cluster, with no database.
//
// Shared by the CLI (scan-standalone.ts) and the local dashboard server
// (dashboard.ts). Every stage reports progress through a `log` callback so a
// caller can stream it to a terminal or an SSE connection.

import { readFileSync, writeFileSync, appendFileSync, existsSync, statSync, mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { sep } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { redditConnector } from '../lib/sources/reddit'
import { hackernewsConnector } from '../lib/sources/hackernews'
import { stackoverflowConnector } from '../lib/sources/stackoverflow'
import { whitespaceFromCounts, type WhitespaceCounts } from '../lib/whitespace'
import { canonicalTopic } from '../lib/topics'
import { dedupePosts, countDuplicates } from '../lib/dedup'
import { findFirstMatch, INTENT_PATTERNS, patternsFor } from '../lib/intent-patterns'
import { makerPreflag } from '../lib/buyer-intent'
import type { RawSignal } from '../lib/sources/types'
import { activeDir } from './sessions'
import {
  loadKnowledge, saveKnowledge, remember, consolidate, vocabulary, postKey,
  VOCAB_IN_PROMPT,
} from './knowledge'
import { loadComments } from './comments'

export const DEFAULT_MODEL = 'claude-haiku-4-5-20251001'

/** Read lazily. A const here would be evaluated at import time — before
 *  loadEnv() runs — so a model saved in .env.local would never take effect. */
export function model(): string {
  loadEnv()
  return process.env.SCAN_MODEL || DEFAULT_MODEL
}

/**
 * Model per call site, chosen by measurement rather than by "bigger is better".
 *
 *   classify  — Haiku. Measured against Sonnet on an identical batch: same
 *               fragmentation (19 distinct topics of 24), and Haiku's labels
 *               were SHORTER and more general ("career respect" vs "programmer
 *               respect discussion"), which is what makes topics collide. It is
 *               also ~95% of all spend, so the economics agree.
 *
 *   plan      — Sonnet. Haiku invented r/EV (does not exist); of the names that
 *               could be verified, Haiku was 1-in-3 fake and Sonnet 0-in-6. A
 *               fabricated subreddit silently collects nothing for weeks.
 *
 *   review    — Sonnet. On a 161-topic vocabulary Haiku proposed 36 merges and
 *               invented the canonical name every time, so all 36 were rejected
 *               and the pass did nothing. Sonnet copied strings exactly.
 *
 *   themes    — Haiku for now. NOT measured; left alone rather than upgraded on
 *               a hunch.
 *
 * One call each for plan/review/themes, so the cost of the stronger model is
 * negligible next to classification.
 */
export const JUDGEMENT_MODEL = 'claude-sonnet-5'

export function modelFor(task: 'classify' | 'plan' | 'review' | 'themes'): string {
  loadEnv()
  if (process.env.SCAN_MODEL) return process.env.SCAN_MODEL
  return task === 'plan' || task === 'review' ? JUDGEMENT_MODEL : DEFAULT_MODEL
}
const BATCH = 12
const GAP_MS = 2_000
const REDDIT_GAP_MS = 30_000
const REQ_TIMEOUT_MS = 20_000

/** Every data path resolves through the ACTIVE session, so switching sessions
 *  swaps corpus, knowledge and results together. */
export const outDir = (): URL => activeDir()

export type Log = (msg: string) => void

/** Structured progress, so the UI can move a real number rather than parse a
 *  log line. */
export type Progress = (p: { stage: string; done: number; total: number }) => void

/** Persist the knowledge cache every N batches. Saving only at the end means a
 *  killed process throws away every classification it already paid for. */
const SAVE_EVERY_BATCHES = 3

export type ScanOptions = {
  subreddits: string[]
  hnQueries: string[]
  soQueries: string[]
  minTopicPosts: number
  /** Classify the accumulated corpus instead of fetching live. */
  useCorpus?: boolean
  /** When reading the corpus, cap how many posts get classified (cost control). */
  corpusLimit?: number
  /** Restrict a corpus scan to these subreddits / source ids. Empty = all.
   *  Without this, a corpus holding two niches answers neither question. */
  corpusFilter?: string[]
  /** Incumbent products a QA pass named when refuting a topic, keyed by topic.
   *  Supplied by the caller so the pipeline never depends on the QA layer. */
  refutedTools?: RefutedTools
  /** Residual gap (still-unserved sub-segment) per refuted topic. */
  refutedGaps?: Record<string, string>
  /** After scoring, challenge each scoreable topic with world knowledge and
   *  return incumbents + residual gaps to fold into saturation. Provided by
   *  the caller (dashboard) because the QA layer sits above the pipeline. */
  challenge?: (topics: ScoredTopic[], log: Log) => Promise<ChallengeResult>
  /** Only classify posts that voice buying intent. Roughly half of a subreddit
   *  feed is news and chat; classifying it costs money and buries real needs
   *  under the subreddit's own subject. */
  demandOnly?: boolean
}

/**
 * Cheap, deterministic read of whether a post voices a need — the same gate
 * lib/try-find.ts uses before spending a model call. Negation-aware, and
 * self-promo ("just launched my app") is excluded: a maker announcing a tool
 * is not a buyer asking for one.
 */
export function looksLikeDemand(s: RawSignal): boolean {
  const text = `${s.title}\n${s.body || ''}`
  if (makerPreflag(text)) return false
  return findFirstMatch(text, INTENT_PATTERNS) !== null
}

/** Does the post express willingness to spend? Distinct from demand — a buyer
 *  naming a price or "I'd pay for X" is a far stronger profit signal than
 *  someone merely asking for recommendations. */
export function willingToPay(s: RawSignal): boolean {
  const text = `${s.title}\n${s.body || ''}`
  return findFirstMatch(text, patternsFor('willing-to-pay')) !== null
}

/** A corpus post — a RawSignal plus when the collector first saw it. */
export type CorpusEntry = RawSignal & { firstSeenAt: number }

export const CATEGORIES = ['pain_point', 'feature_request', 'tool_complaint', 'other'] as const

/** The model can return a value outside the declared enum. Anything unknown
 *  becomes 'other' — an off-enum category would be counted in a topic's total
 *  but never in its demand, silently corrupting every whitespace input. */
export function coerceCategory(v: unknown): Classified['category'] {
  return (CATEGORIES as readonly string[]).includes(v as string)
    ? (v as Classified['category'])
    : 'other'
}

export type Classified = {
  category: 'pain_point' | 'feature_request' | 'tool_complaint' | 'other'
  topic: string
  tools: string[]
  dissatisfied: boolean
}

/** A single demand post — the raw evidence and, for outreach, the lead. */
export type DemandPost = {
  title: string
  body: string
  author: string
  url: string
  source: string
  /** Whether the post named a price or said "I'd pay" — the profit signal. */
  wtp: boolean
}

export type ScoredTopic = {
  topic: string
  posts: number
  demand: number
  unanswered: number
  distinctTools: number
  tools: string[]
  /** Raw openness from lib/whitespace.ts. */
  whitespace: number
  /** Products a QA pass named when it refuted this topic, if any. */
  refutedBy?: string[]
  /** The still-unserved sub-segment the QA Skeptic named, when it refuted. */
  residualGap?: string
  /** Demand posts whose text names a price or says "I'd pay". */
  willingToPay: number
  /** Composite 0..1 "worth building" signal — see profitability(). */
  profitability: number
  /** 0..1 — how much evidence stands behind that score. */
  confidence: number
  /** whitespace shrunk toward neutral by confidence. Ranking uses this. */
  ranked: number
  examples: Array<{ title: string; url: string }>
  /** The actual demand posts behind this topic — the people who voiced the
   *  need, with author and link, so a finding is traceable to a lead. */
  leads: DemandPost[]
}

/**
 * Evidence shrinkage.
 *
 * Two posts naming no tool produce unansweredDemand = 1.0 and saturation = 0,
 * which is a near-perfect "nobody has built this" — from two people. Without
 * this, the thinnest evidence always outranks the strongest: a 2-post topic
 * scored 0.998 while an 18-post topic naming 18 tools scored 0.244.
 *
 * So the score is pulled toward neutral in proportion to how little evidence
 * supports it. n/(n+K) reaches half weight at K posts. Nothing is hidden —
 * the raw score is still reported next to it.
 */
const CONFIDENCE_K = 6
export function evidenceConfidence(posts: number): number {
  return posts / (posts + CONFIDENCE_K)
}
export function shrinkToNeutral(whitespace: number, posts: number): number {
  const c = evidenceConfidence(posts)
  return 0.5 + (whitespace - 0.5) * c
}

/**
 * Composite 0..1 "worth building" signal. Deterministic and transparent — a
 * weighted mix of what the pipeline actually measured:
 *   demand      (distinct people, saturates at 20 posts)
 *   willingness (share of demand posts naming a price / "I'd pay") — the
 *                strongest profit signal
 *   gap         (the Skeptic named a concrete still-unserved segment)
 *   openness    (evidence-weighted whitespace, already QA-challenged)
 *   pain        (share of demand posts dissatisfied with no incumbent named)
 */
export function profitability(
  posts: number,
  demand: number,
  wtp: number,
  pain: number,
  openness: number,
  hasGap: boolean,
): number {
  const d = Math.min(1, posts / 20)
  const w = demand > 0 ? wtp / demand : 0
  const p = demand > 0 ? pain / demand : 0
  const g = hasGap ? 1 : 0
  return 0.25 * d + 0.30 * w + 0.20 * g + 0.15 * openness + 0.10 * p
}

export type Theme = {
  theme: string
  pain: string
  toolIdea: string
  topics?: string[]
  demand: number
}

export type ScanResult = {
  finishedAt: string
  /** True when the run was interrupted — a partial result must never read as
   *  a complete one once it has been reloaded from disk. */
  cancelled: boolean
  collected: number
  classified: number
  distinctTopics: number
  categories: Record<string, number>
  /** Topics that never reached minTopicPosts — the signal was too thin to score. */
  singletonTopics: number
  /** What this run cost and what it learned — see knowledge.ts. */
  learning: {
    fromCache: number
    billed: number
    reusedTopic: number
    newTopic: number
    vocabBefore: number
    vocabAfter: number
  }
  themes: Theme[]
  niches: NicheSuggestion[]
  topics: ScoredTopic[]
  sources: ScanOptions
}

// --- env --------------------------------------------------------------------

let envLoaded = false
export function loadEnv(): void {
  if (envLoaded) return
  envLoaded = true
  const p = process.env.EARWISE_HOME
    ? new URL('.env.local', pathToFileURL(process.env.EARWISE_HOME.endsWith(sep) ? process.env.EARWISE_HOME : process.env.EARWISE_HOME + sep))
    : new URL('../.env.local', import.meta.url)
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim())
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

function client(): Anthropic {
  loadEnv()
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('ANTHROPIC_API_KEY missing — add it to .env.local')
  return new Anthropic({ apiKey: key })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** sleep() that wakes early when aborted — otherwise a cancel during the 30s
 *  Reddit gap would sit there for the full gap before anyone noticed. */
function sleepUntil(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return sleep(ms) as Promise<void>
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const t = setTimeout(done, ms)
    function done() {
      clearTimeout(t)
      signal!.removeEventListener('abort', done)
      resolve()
    }
    signal!.addEventListener('abort', done, { once: true })
  })
}

// --- cache ------------------------------------------------------------------

export function readResult(): ScanResult | null {
  const p = new URL('scan.json', outDir())
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as ScanResult
  } catch {
    return null
  }
}

export function writeResult(r: ScanResult): void {
  writeFileSync(new URL('scan.json', outDir()), JSON.stringify(r, null, 2))
}

export function rawSignalsAge(): number | null {
  const p = new URL('raw-signals.json', outDir())
  if (!existsSync(p)) return null
  return Date.now() - statSync(p).mtimeMs
}

// --- corpus -----------------------------------------------------------------

const corpusFile = () => new URL('corpus.jsonl', outDir())

/**
 * Append newly-seen posts to the corpus, skipping anything already there.
 * Both gathering paths — the background collector AND a live scan — must land
 * in the same store, or a live scan silently throws away everything it fetched
 * and the corpus panel reports "empty" right after pulling hundreds of posts.
 */
export function appendToCorpus(signals: RawSignal[]): number {
  if (!signals.length) return 0
  const seen = new Set(loadCorpus().map((e) => `${e.source}:${e.externalId}`))
  const now = Date.now()
  const fresh: CorpusEntry[] = []
  for (const s of signals) {
    const k = `${s.source}:${s.externalId}`
    if (seen.has(k)) continue
    seen.add(k)
    fresh.push({ ...s, firstSeenAt: now })
  }
  if (!fresh.length) return 0
  appendFileSync(corpusFile(), fresh.map((e) => JSON.stringify(e)).join('\n') + '\n')
  return fresh.length
}

/** Read the collector's append-only corpus. Torn lines are skipped, not fatal. */
export function loadCorpus(): CorpusEntry[] {
  if (!existsSync(corpusFile())) return []
  const out: CorpusEntry[] = []
  for (const line of readFileSync(corpusFile(), 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      out.push(JSON.parse(line) as CorpusEntry)
    } catch {
      /* skip */
    }
  }
  return out
}

export type CorpusStats = {
  posts: number
  bySource: Record<string, number>
  firstSeenAt: number | null
  lastSeenAt: number | null
  uniqueAuthors: number
  /** Already classified — these never cost anything again. */
  classified: number
  /** Not yet classified — the real pool a corpus scan draws from. */
  pending: number
  /** Which subreddits the corpus actually holds, biggest first — so a corpus
   *  collected from one niche can't be mistaken for another. */
  subs: Array<{ name: string; count: number }>
}

export type SourceHealth = {
  key: string
  fetched: number
  added: number
  fails: number
  zeroRuns: number
  lastRunAt: number
  backoffUntil: number
  lastError?: string
  /** Never yielded, and has been tried enough times that throttling is an
   *  unlikely explanation. Matches the collector's own ZERO_YIELD_LIMIT — the
   *  UI must not be more confident than the process producing the data. */
  dead: boolean
  /** Tried, empty so far, but not yet enough attempts to judge. */
  unproven: boolean
  /** Still in collector-sources.json. Stale entries linger in state forever
   *  after a retarget, and must not be reported as current failures. */
  configured: boolean
}

/** Mirrors ZERO_YIELD_LIMIT in collector.ts. */
const DEAD_AFTER_EMPTIES = 3

/** Per-source yield from the collector, so sources that produce nothing surface
 *  instead of silently wasting cycles for weeks. */
export function collectorHealth(): SourceHealth[] {
  const p = new URL('collector-state.json', outDir())
  if (!existsSync(p)) return []

  const configured = new Set<string>()
  const cp = new URL('collector-sources.json', outDir())
  let haveConfig = false
  if (existsSync(cp)) {
    try {
      const c = JSON.parse(readFileSync(cp, 'utf8')) as Record<string, string[]>
      for (const [kind, list] of Object.entries(c)) {
        for (const q of Array.isArray(list) ? list : []) configured.add(`${kind}:${q}`)
      }
      haveConfig = true
    } catch {
      /* fall through — treat everything as configured */
    }
  }

  try {
    const st = JSON.parse(readFileSync(p, 'utf8')) as {
      sources: Record<string, Omit<SourceHealth, 'key' | 'dead' | 'unproven' | 'configured'>>
    }
    return Object.entries(st.sources ?? {})
      .map(([key, s]) => {
        const empty = s.fetched === 0 && s.lastRunAt > 0
        const tries = s.zeroRuns ?? 0
        return {
          key,
          ...s,
          dead: empty && tries >= DEAD_AFTER_EMPTIES,
          unproven: empty && tries < DEAD_AFTER_EMPTIES,
          configured: haveConfig ? configured.has(key) : true,
        }
      })
      .sort((a, b) => Number(b.configured) - Number(a.configured) || b.added - a.added)
  } catch {
    return []
  }
}

export function corpusStats(): CorpusStats {
  const rows = loadCorpus()
  const done = loadKnowledge().posts
  let classified = 0
  const bySource: Record<string, number> = {}
  const bySub = new Map<string, number>()
  const authors = new Set<string>()
  let first: number | null = null
  let last: number | null = null
  for (const r of rows) {
    if (done[postKey(r.source, r.externalId)]) classified++
    bySource[r.source] = (bySource[r.source] ?? 0) + 1
    if (r.author) authors.add(`${r.source}:${r.author}`)
    if (first === null || r.firstSeenAt < first) first = r.firstSeenAt
    if (last === null || r.firstSeenAt > last) last = r.firstSeenAt
    if (r.source === 'reddit') {
      const m = /\/r\/([^/]+)/.exec(r.url ?? '')
      if (m) bySub.set(m[1], (bySub.get(m[1]) ?? 0) + 1)
    }
  }
  const subs = Array.from(bySub.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }))
  return {
    posts: rows.length,
    classified,
    pending: rows.length - classified,
    bySource,
    firstSeenAt: first,
    lastSeenAt: last,
    uniqueAuthors: authors.size,
    subs,
  }
}

// --- collect ----------------------------------------------------------------

export async function collect(opts: ScanOptions, log: Log, signal?: AbortSignal): Promise<RawSignal[]> {
  const all: RawSignal[] = []
  const seen = new Set<string>()

  // Connectors call fetch() with no deadline of their own, so a host that
  // tarpits rather than refusing would hang the run. Always pass a timeout.
  const deadline = () => AbortSignal.timeout(REQ_TIMEOUT_MS)

  type Job = { label: string; gap: number; run: () => Promise<RawSignal[]> }
  const jobs: Job[] = [
    // Tolerant sources first, so a Reddit block doesn't cost the whole run.
    ...opts.hnQueries.map((q) => ({
      label: `hn "${q}"`,
      gap: GAP_MS,
      run: () => hackernewsConnector.search(q, deadline()),
    })),
    ...opts.soQueries.map((q) => ({
      label: `stackoverflow "${q}"`,
      gap: GAP_MS,
      run: () => stackoverflowConnector.search(q, deadline()),
    })),
    ...opts.subreddits.map((s) => ({
      label: `reddit r/${s}`,
      gap: REDDIT_GAP_MS,
      run: () => redditConnector.search(s, deadline()),
    })),
  ]

  for (let i = 0; i < jobs.length; i++) {
    if (signal?.aborted) {
      log(`cancelled — ${all.length} collected so far`)
      break
    }
    const { label, gap, run } = jobs[i]
    try {
      const got = await run()
      let fresh = 0
      for (const s of got) {
        const k = `${s.source}:${s.externalId}`
        if (seen.has(k)) continue
        seen.add(k)
        all.push(s)
        fresh++
      }
      log(`${label} — ${got.length} fetched, ${fresh} new`)
    } catch (err) {
      log(`${label} — FAILED: ${(err as Error).message}`)
    }
    // No need to wait after the last job.
    if (i < jobs.length - 1) await sleepUntil(gap, signal)
  }

  const added = appendToCorpus(all)
  log(`${added} new post${added === 1 ? '' : 's'} added to the corpus`)
  return all
}

// --- classify ---------------------------------------------------------------

const CLASSIFY_TOOL: Anthropic.Messages.Tool = {
  name: 'classify_signals',
  description: 'Classify each numbered post.',
  input_schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            i: { type: 'number', description: 'The post number' },
            category: {
              type: 'string',
              enum: ['pain_point', 'feature_request', 'tool_complaint', 'other'],
            },
            topic: {
              type: 'string',
              description:
                'A GENERAL 2-3 word lowercase topic that similar posts would also produce, ' +
                'e.g. "database migrations", "log search", "invoice generation". Prefer the ' +
                'broadest wording that still describes the need.',
            },
            tools: {
              type: 'array',
              items: { type: 'string' },
              description: 'Named existing products mentioned. Empty if none.',
            },
            dissatisfied: {
              type: 'boolean',
              description: 'Expresses frustration with an existing tool',
            },
          },
          required: ['i', 'category', 'topic', 'tools', 'dissatisfied'],
        },
      },
    },
    required: ['items'],
  },
}

const CLASSIFY_SYSTEM_BASE =
  'You classify developer forum posts for a demand study. Be strict: "other" is the correct ' +
  'answer for news, showoff posts, job ads, and general discussion. Only mark pain_point or ' +
  'feature_request when someone describes a real unmet need. In `tools`, list only NAMED ' +
  'existing products (e.g. "Postgres", "Vercel") — never generic nouns. For `topic`, choose ' +
  'the most GENERAL phrasing that still fits: topics must collide across posts to be useful, ' +
  'so prefer "log search" over "searching nginx logs on a k8s cluster".'

/** Show the classifier the vocabulary it has already established. Without this
 *  it invents fresh wording per post and every topic stays a singleton, which
 *  is why the whitespace model never had anything to score.
 *
 *  The instruction deliberately permits new topics: forcing a post into a
 *  near-miss existing bucket would corrupt the counts that everything else
 *  depends on, and would make the vocabulary self-confirming. */
function classifySystem(known: string[]): string {
  if (!known.length) return CLASSIFY_SYSTEM_BASE
  return (
    CLASSIFY_SYSTEM_BASE +
    '\n\nTopics already established in this study — REUSE the exact string when one ' +
    'genuinely fits, so counts accumulate:\n' +
    known.map((t) => `- ${t}`).join('\n') +
    '\n\nIf none genuinely fits, write a new general topic. Forcing a bad fit is worse ' +
    'than adding a topic.'
  )
}

export type ClassifyOutcome = {
  rows: Array<{ signal: RawSignal; c: Classified }>
  fromCache: number
  billed: number
  reusedTopic: number
  newTopic: number
  vocabBefore: number
  vocabAfter: number
}

/**
 * Classify, but never twice. Posts already in the knowledge cache are returned
 * from disk; only genuinely new posts reach the model. The classifier is shown
 * the topic vocabulary it has already established so labels collide instead of
 * fragmenting.
 */
export async function classifyAll(
  signals: RawSignal[],
  log: Log,
  signal?: AbortSignal,
  onProgress?: Progress,
  demandOnly = false,
): Promise<ClassifyOutcome> {
  const k = loadKnowledge()
  const vocabBefore = Object.keys(k.topics).length

  const rows: Array<{ signal: RawSignal; c: Classified }> = []
  let todo: RawSignal[] = []
  for (const s of signals) {
    const hit = k.posts[postKey(s.source, s.externalId)]
    if (hit) rows.push({ signal: s, c: hit })
    else todo.push(s)
  }
  const fromCache = rows.length
  if (fromCache) log(`${fromCache} of ${signals.length} already known — not re-classifying`)

  // Split on the cheap gate before spending anything. Demand-shaped posts go
  // first either way, so an interrupted or capped run spends its budget on the
  // posts that can actually produce a finding.
  if (todo.length) {
    const wanted = todo.filter(looksLikeDemand)
    const rest = todo.filter((x) => !looksLikeDemand(x))
    const pct = Math.round((wanted.length / todo.length) * 100)
    if (demandOnly) {
      log(`${wanted.length} of ${todo.length} voice a need (${pct}%) — skipping the rest`)
      todo = wanted
    } else {
      log(`${wanted.length} of ${todo.length} voice a need (${pct}%) — classifying those first`)
      todo = [...wanted, ...rest]
    }
  }

  if (!todo.length) {
    log('nothing new to classify')
    return { rows, fromCache, billed: 0, reusedTopic: 0, newTopic: 0, vocabBefore, vocabAfter: vocabBefore }
  }

  const anthropic = client()
  // Replies are where the tool names and the gripes live; a post asking "what
  // do you use for X" names nothing itself.
  const comments = loadComments()
  const known = vocabulary(k, VOCAB_IN_PROMPT)
  if (known.length) log(`priming with ${known.length} known topics`)
  const system = classifySystem(known)

  let billed = 0
  let reusedTopic = 0
  let newTopic = 0

  for (let i = 0; i < todo.length; i += BATCH) {
    // Checked per batch: a cancel lands within one batch rather than running
    // the whole queue and billing for work nobody is waiting on.
    if (signal?.aborted) {
      log(`cancelled after ${billed} of ${todo.length} new posts`)
      break
    }
    const batch = todo.slice(i, i + BATCH)
    const list = batch
      .map((s, n) => {
        const reps = comments[postKey(s.source, s.externalId)] || []
        const tail = reps.length
          ? `\nREPLIES: ` + reps.slice(0, 6).map((r) => r.slice(0, 300)).join(` | `)
          : ``
        return `${n}. [${s.source}] ${s.title}\n${(s.body || '').slice(0, 320)}${tail}`
      })
      .join('\n\n')
    try {
      const res = await anthropic.messages.create({
        model: modelFor('classify'),
        max_tokens: 2000,
        system,
        tools: [CLASSIFY_TOOL],
        tool_choice: { type: 'tool', name: 'classify_signals' },
        messages: [{ role: 'user', content: `Classify these ${batch.length} posts:

${list}` }],
      })
      const block = res.content.find((c) => c.type === 'tool_use')
      if (block?.type === 'tool_use') {
        const items = (block.input as { items?: unknown[] }).items ?? []
        const now = Date.now()
        for (const it of items) {
          const o = it as Classified & { i: number }
          if (typeof o.i !== 'number' || !batch[o.i]) continue
          const sig = batch[o.i]
          const c: Classified = {
            category: coerceCategory(o.category),
            // Canonicalize with the app's own deterministic pass. Exact string
            // equality on natural language leaves every topic a singleton —
            // "auth problems" and "authentication issues" must be one topic
            // for counts to accumulate at all.
            topic: canonicalTopic(o.topic) ?? '',
            tools: Array.isArray(o.tools) ? o.tools.filter(Boolean) : [],
            dissatisfied: !!o.dissatisfied,
          }
          // remember() reports whether the topic already existed — that ratio
          // is the falsifiable claim that this is learning and not decoration.
          if (remember(k, postKey(sig.source, sig.externalId), c, now)) reusedTopic++
          else if (c.topic && c.category !== 'other') newTopic++
          rows.push({ signal: sig, c })
          billed++
        }
      }
    } catch (err) {
      log(`classify batch at ${i} failed: ${(err as Error).message}`)
    }
    log(`classified ${billed}/${todo.length} new`)
    onProgress?.({ stage: 'classifying', done: billed, total: todo.length })

    // Checkpoint. A crash or a kill now costs at most SAVE_EVERY_BATCHES
    // batches, not the whole run.
    if (((i / BATCH) | 0) % SAVE_EVERY_BATCHES === SAVE_EVERY_BATCHES - 1) saveKnowledge(k)

    if (i + BATCH < todo.length) await sleepUntil(GAP_MS, signal)
  }

  const dropped = consolidate(k, Date.now())
  if (dropped) log(`forgot ${dropped} stale one-off topics`)
  k.runs.push({ at: Date.now(), fromCache, classified: billed, reusedTopic, newTopic })
  if (k.runs.length > 200) k.runs = k.runs.slice(-200)
  saveKnowledge(k)

  const vocabAfter = Object.keys(k.topics).length
  if (billed) {
    log(`topic reuse ${Math.round((reusedTopic / billed) * 100)}% · vocabulary ${vocabBefore} → ${vocabAfter}`)
  }
  return { rows, fromCache, billed, reusedTopic, newTopic, vocabBefore, vocabAfter }
}

// --- score ------------------------------------------------------------------

type Agg = {
  total: number
  toolComplaint: number
  demand: number
  demandNoTool: number
  hate: number
  wtp: number
  tools: Set<string>
  examples: Array<{ title: string; url: string }>
  leads: DemandPost[]
}

/**
 * Products the Skeptic named when it refuted a topic, keyed by topic.
 *
 * This is the correction for the tool's worst failure. `unansweredDemand` counts
 * posts that named no tool — but somebody asking "what do you use for pipeline
 * tracking" does not list CRMs in their question, so silence was read as
 * opportunity. A QA run refuted 100% of the top five topics with real products
 * (Pipedrive, Otter.ai, Jira). Those names ARE the missing saturation evidence,
 * so they are folded in here rather than left in a report nobody re-reads.
 */
export type RefutedTools = Record<string, string[]>
/** What a challenge pass returns: incumbents to fold into saturation, plus the
 *  residual gap each refuted topic still leaves unserved. */
export type ChallengeResult = { tools: RefutedTools; gaps: Record<string, string> }

export function scoreTopics(
  classified: Array<{ signal: RawSignal; c: Classified }>,
  minPosts: number,
  refuted: RefutedTools = {},
  gaps: Record<string, string> = {},
): { scored: ScoredTopic[]; distinct: number; singletons: number; topicInput: Array<[string, number, string]> } {
  const byTopic = new Map<string, Agg>()

  for (const { signal, c } of classified) {
    if (!c.topic || c.category === 'other') continue
    const a =
      byTopic.get(c.topic) ??
      {
        total: 0,
        toolComplaint: 0,
        demand: 0,
        demandNoTool: 0,
        hate: 0,
        wtp: 0,
        tools: new Set<string>(),
        examples: [],
        leads: [],
      }
    a.total++
    if (c.category === 'tool_complaint') a.toolComplaint++
    if (c.category === 'pain_point' || c.category === 'feature_request') {
      a.demand++
      // "No tool named" is not "unmet" — a seeker asking "what do you use
      // for X" names no tool *because they're asking*. Only an unhappy post
      // that points at no incumbent is evidence nothing addresses it.
      if (c.tools.length === 0 && c.dissatisfied) a.demandNoTool++
    }
    if (c.dissatisfied) a.hate++
    const wtp = willingToPay(signal)
    if (wtp) a.wtp++
    for (const t of c.tools) a.tools.add(t)
    if (a.examples.length < 3) {
      a.examples.push({ title: signal.title.slice(0, 140), url: signal.url })
    }
    // Keep the post itself, not just its title. A finding without the people
    // behind it is unactionable: the author + link are the lead.
    if (a.leads.length < 40) {
      a.leads.push({
        title: signal.title.slice(0, 200),
        body: (signal.body || '').slice(0, 600),
        author: signal.author || '',
        url: signal.url || '',
        source: signal.source,
        wtp,
      })
    }
    byTopic.set(c.topic, a)
  }

  const scored: ScoredTopic[] = Array.from(byTopic.entries())
    .filter(([, a]) => a.total >= minPosts)
    .map(([topic, a]) => {
      // Known incumbents count as saturation even when no post named them.
      const known = new Set(a.tools)
      for (const t of refuted[topic] ?? []) known.add(t)
      const refutedCount = (refuted[topic] ?? []).length

      // If the market is known to be served, "nobody named a tool" is not
      // evidence of an opening — it is evidence the asker did not type one.
      const unmet = refutedCount > 0 ? 0 : a.demandNoTool

      const counts: WhitespaceCounts = {
        total: a.total,
        toolComplaintPosts: a.toolComplaint,
        deepCount: a.total,
        deepDemand: a.demand,
        deepDemandNoTool: unmet,
        hateQuotes: a.hate,
        distinctTools: known.size,
      }
      const ws = whitespaceFromCounts(counts)
      const rk = shrinkToNeutral(ws, a.total)
      return {
        topic,
        posts: a.total,
        demand: a.demand,
        unanswered: a.demandNoTool,
        willingToPay: a.wtp,
        distinctTools: known.size,
        tools: Array.from(known).slice(0, 8),
        refutedBy: refutedCount ? (refuted[topic] ?? []).slice(0, 8) : undefined,
        residualGap: gaps[topic] || undefined,
        whitespace: ws,
        confidence: evidenceConfidence(a.total),
        ranked: rk,
        profitability: profitability(a.total, a.demand, a.wtp, a.demandNoTool, rk, !!gaps[topic]),
        examples: a.examples,
        leads: a.leads,
      }
    })
    .sort((x, y) => y.ranked - x.ranked || y.posts - x.posts)

  const topicInput: Array<[string, number, string]> = Array.from(byTopic.entries())
    .sort((x, y) => y[1].total - x[1].total)
    .slice(0, 120)
    .map(([t, a]) => [t, a.total, a.examples[0]?.title ?? ''])

  const singletons = Array.from(byTopic.values()).filter((a) => a.total < minPosts).length
  return { scored, distinct: byTopic.size, singletons, topicInput }
}

// --- cluster ----------------------------------------------------------------

const THEMES_TOOL: Anthropic.Messages.Tool = {
  name: 'demand_themes',
  description: 'Cluster granular demand topics into broad, buildable themes ranked by demand.',
  input_schema: {
    type: 'object',
    properties: {
      themes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            theme: { type: 'string', description: 'Short theme name' },
            pain: { type: 'string', description: 'The recurring underlying pain, one line' },
            toolIdea: { type: 'string', description: 'A concrete low/no-cost tool that solves it' },
            topics: { type: 'array', items: { type: 'string' } },
            demand: { type: 'number', description: 'Sum of post counts across covered topics' },
          },
          required: ['theme', 'pain', 'toolIdea', 'demand'],
        },
      },
    },
    required: ['themes'],
  },
}

export async function clusterThemes(topicInput: Array<[string, number, string]>): Promise<Theme[]> {
  if (!topicInput.length) return []
  const anthropic = client()
  const list = topicInput.map(([t, n, ex]) => `- ${t} (${n})${ex ? `: "${ex}"` : ''}`).join('\n')
  const res = await anthropic.messages.create({
    model: modelFor('themes'),
    max_tokens: 2000,
    system:
      'You are a skeptical product strategist for a solo founder who ships small, low- or ' +
      'no-cost tools. Cluster the demand topics below into 4-8 BROAD, buildable themes. For ' +
      'each: a short theme name, the recurring pain in one line, a concrete cheap tool idea, ' +
      'the covered input topics, and demand = sum of their post counts. Rank by demand. Only ' +
      'surface genuinely recurring pains — if a topic appears once, leave it out rather than ' +
      'inflate a theme. Returning few themes is correct when the evidence is thin.',
    tools: [THEMES_TOOL],
    tool_choice: { type: 'tool', name: 'demand_themes' },
    messages: [{ role: 'user', content: `Demand topics — "topic (post count): example":\n${list}` }],
  })
  const block = res.content.find((c) => c.type === 'tool_use')
  if (block?.type !== 'tool_use') return []
  const themes = (block.input as { themes?: Theme[] }).themes ?? []
  return Array.isArray(themes) ? themes : []
}

// --- niche synthesis --------------------------------------------------------
// Turns scored topics into a ranked list of "build this" opportunities. This is
// the headline output: not "which spaces are open" but "which are worth building
// for". It is a model call grounded in measured evidence — the actual post
// titles, willingness-to-pay counts and residual gaps — so it cannot invent
// demand, only rank and frame what the corpus already showed.

export type NicheSuggestion = {
  niche: string
  buyer: string
  whyProfitable: string
  v1Product: string
  pricePoint: string
  /** How much measured evidence backs this suggestion. */
  confidence: 'high' | 'medium' | 'low'
  /** The exact topic strings this niche is grounded in, so the UI can show
   *  the actual posts (leads) behind the recommendation. */
  topics?: string[]
}

const NICHES_TOOL: Anthropic.Messages.Tool = {
  name: 'suggest_niches',
  description: 'Rank the most profitable niche opportunities from measured demand.',
  input_schema: {
    type: 'object',
    properties: {
      niches: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            niche: { type: 'string', description: 'A concrete, sellable niche name (2-5 words)' },
            buyer: { type: 'string', description: 'Who specifically holds the budget and pays' },
            whyProfitable: {
              type: 'string',
              description: 'The profit case, grounded in what the posts actually said. Cite the pain, not a platitude.',
            },
            v1Product: {
              type: 'string',
              description: 'A concrete first product a solo dev can ship in 2-4 weeks',
            },
            pricePoint: {
              type: 'string',
              description: 'What these buyers already pay or would pay (a range is fine)',
            },
            confidence: {
              type: 'string',
              enum: ['high', 'medium', 'low'],
              description: 'How much measured evidence supports this — high only when posts recur and name a budget or pain',
            },
            topics: {
              type: 'array',
              items: { type: 'string' },
              description: 'The EXACT topic strings from the input list this niche is grounded in, for traceability back to the source posts.',
            },
          },
          required: ['niche', 'buyer', 'whyProfitable', 'v1Product', 'pricePoint', 'confidence', 'topics'],
        },
      },
    },
    required: ['niches'],
  },
}

export async function synthesizeNiches(
  topics: ScoredTopic[],
  log: Log,
  max = 6,
): Promise<NicheSuggestion[]> {
  // Rank by the deterministic profitability score, then let the model frame the
  // top ones. A weak corpus yields few candidates and the model is told to say
  // so rather than invent demand.
  const top = [...topics].sort((a, b) => b.profitability - a.profitability).slice(0, 12)
  if (!top.length) {
    log('no scoreable topics to turn into niche suggestions')
    return []
  }
  const evidence = top
    .map((t, i) => {
      const wtp = t.willingToPay ? ` · ${t.willingToPay} willing-to-pay` : ''
      const gap = t.residualGap ? `\n   unserved segment: ${t.residualGap}` : ''
      const tools = t.tools.length ? t.tools.join(', ') : 'none named'
      const ex = t.examples.map((e) => e.title).join(' | ')
      return `${i + 1}. "${t.topic}" — ${t.posts} posts${wtp} · existing: ${tools}${gap}\n   examples: ${ex}`
    })
    .join('\n\n')

  const anthropic = client()
  const res = await anthropic.messages.create({
    model: JUDGEMENT_MODEL,
    max_tokens: 2500,
    system:
      'You are a sharp niche-hunter for a solo founder who ships small paid tools. Below are ' +
      'the top demand topics found in real forum posts, with the actual post titles as evidence. ' +
      'Rank the MOST PROFITABLE niche opportunities to build for.\n\n' +
      'Rules:\n' +
      '- Ground every claim in the evidence given. Do NOT invent demand, buyers, or pain.\n' +
      '- Prefer niches where the posts show willingness to pay, an existing tool budget, or a ' +
      'recurring complaint.\n' +
      '- "high" confidence only when the same need recurs and the posts name a price or pain. ' +
      'Thin evidence = "low", and say why it is thin rather than inflating it.\n' +
      '- If nothing is worth building, return an empty list. Fewer, sharper niches beat a padded list.\n' +
      '- For every niche, set `topics` to the EXACT topic strings from the input you grounded it in.',
    tools: [NICHES_TOOL],
    tool_choice: { type: 'tool', name: 'suggest_niches' },
    messages: [{ role: 'user', content: `Measured demand:\n\n${evidence}` }],
  })
  const block = res.content.find((c) => c.type === 'tool_use')
  if (block?.type !== 'tool_use') return []
  const niches = (block.input as { niches?: NicheSuggestion[] }).niches ?? []
  const out = Array.isArray(niches) ? niches.slice(0, max) : []
  log(`${out.length} profitable niche suggestion${out.length === 1 ? '' : 's'}`)
  return out
}

// --- source planning --------------------------------------------------------
// Turns a 1-3 word audience into concrete sources to point the collector at.
//
// IMPORTANT: everything this returns is a PRIOR — the model's general knowledge
// about which markets carry budget. It is not measured demand. It decides where
// to LOOK; the corpus and the whitespace score decide what is real. The UI
// labels it accordingly and nothing downstream treats it as evidence.

export type NichePlan = {
  niche: string
  whyMoneyFlows: string
  /** 0..1 prior on commercial intent — a guess, not a measurement. */
  commercialIntent: number
  buyer: string
  subreddits: string[]
  hnQueries: string[]
  soQueries: string[]
  /** Result of checking each named subreddit actually exists. */
  verified?: Record<string, 'ok' | 'missing' | 'unknown'>
}

const PLAN_TOOL: Anthropic.Messages.Tool = {
  name: 'plan_sources',
  description: 'Propose niches and the concrete communities where their buyers talk.',
  input_schema: {
    type: 'object',
    properties: {
      niches: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            niche: { type: 'string', description: 'Short niche name, 2-5 words' },
            buyer: { type: 'string', description: 'Who actually holds the budget' },
            whyMoneyFlows: {
              type: 'string',
              description:
                'One line: why money moves here — what breaks, what it costs them, what they already pay for',
            },
            commercialIntent: {
              type: 'number',
              description: '0..1 estimate of willingness to pay. Be harsh; hobbyist spaces score low.',
            },
            subreddits: {
              type: 'array',
              items: { type: 'string' },
              description: 'REAL subreddit names, no r/ prefix, 3-6 of them. Only ones you are confident exist.',
            },
            hnQueries: {
              type: 'array',
              items: { type: 'string' },
              description: '2-3 Hacker News search phrases people in this niche would write',
            },
            soQueries: {
              type: 'array',
              items: { type: 'string' },
              description: '1-2 Stack Overflow search phrases. Empty if the niche is not technical.',
            },
          },
          required: ['niche', 'buyer', 'whyMoneyFlows', 'commercialIntent', 'subreddits', 'hnQueries', 'soQueries'],
        },
      },
    },
    required: ['niches'],
  },
}

const PLAN_SYSTEM =
  'You pick where a solo builder should listen for unmet demand. Money flows where a ' +
  'business loses revenue, faces a deadline, or risks a fine — not where hobbyists tinker. ' +
  'Favour buyers who ALREADY pay for tools, because proven spend beats theoretical need. ' +
  'Rate commercialIntent harshly: consumer and hobbyist spaces belong below 0.4 no matter ' +
  'how active they are; B2B with existing tool budgets belongs above 0.7. Only name ' +
  'subreddits you are confident actually exist — a wrong name silently collects nothing. ' +
  'Be concrete and specific; generic advice is useless here.'

/**
 * Does this subreddit exist and have anything in it? The planner invents
 * plausible-sounding names, and a wrong one silently collects nothing for
 * weeks. Best-effort: a throttle is reported as 'unknown', never as 'missing',
 * because guessing wrong in that direction would delete good sources.
 */
export async function verifySubreddit(name: string): Promise<'ok' | 'missing' | 'unknown'> {
  try {
    const res = await fetch(
      `https://www.reddit.com/r/${encodeURIComponent(name)}/new.rss?limit=1`,
      {
        headers: {
          'User-Agent': 'web:earwise-app:v1.0 (by /u/anonymous)',
          Accept: 'application/atom+xml,application/xml',
        },
        signal: AbortSignal.timeout(12_000),
      },
    )
    if (res.status === 404) return 'missing'
    if (!res.ok) return 'unknown' // 429 means throttled, never "does not exist"
    const xml = await res.text()
    return xml.includes('<entry>') ? 'ok' : 'missing'
  } catch {
    return 'unknown'
  }
}

export type PlanProgress = (e: { stage: string; detail?: string; niche?: NichePlan }) => void

export async function planSources(
  niche: string,
  count: number,
  onProgress?: PlanProgress,
): Promise<NichePlan[]> {
  const anthropic = client()
  const ask = niche.trim()
    ? `Audience: "${niche.trim()}". Propose ${count} niche${count > 1 ? 's' : ''} within or adjacent to it.`
    : `Propose ${count} DIFFERENT niches where money clearly flows and a solo builder could ` +
      `realistically listen in. Spread them across different industries — do not return ${count} ` +
      `variations of software development.`

  onProgress?.({
    stage: 'thinking',
    detail: niche.trim() ? `mapping niches around "${niche.trim()}"` : 'looking for markets where money moves',
  })
  const res = await anthropic.messages.create({
    model: modelFor('plan'),
    max_tokens: 2500,
    system: PLAN_SYSTEM,
    tools: [PLAN_TOOL],
    tool_choice: { type: 'tool', name: 'plan_sources' },
    messages: [{ role: 'user', content: ask }],
  })
  const block = res.content.find((c) => c.type === 'tool_use')
  if (block?.type !== 'tool_use') return []
  const raw = (block.input as { niches?: unknown[] }).niches ?? []
  if (!Array.isArray(raw)) return []

  const subRe = /^[a-z0-9_]{2,21}$/i
  const plans = raw.slice(0, 8).map((n) => {
    const o = n as NichePlan
    return {
      niche: String(o.niche ?? '').slice(0, 80),
      buyer: String(o.buyer ?? '').slice(0, 120),
      whyMoneyFlows: String(o.whyMoneyFlows ?? '').slice(0, 300),
      commercialIntent: Math.max(0, Math.min(1, Number(o.commercialIntent) || 0)),
      // Same cleaning the app's own suggestSubreddits applies — a malformed
      // name would silently collect nothing.
      subreddits: (Array.isArray(o.subreddits) ? o.subreddits : [])
        .map((s) => String(s).trim().replace(/^\/?r\//i, ''))
        .filter((s) => subRe.test(s))
        .slice(0, 6),
      hnQueries: (Array.isArray(o.hnQueries) ? o.hnQueries : []).map(String).slice(0, 3),
      soQueries: (Array.isArray(o.soQueries) ? o.soQueries : []).map(String).slice(0, 2),
      verified: undefined as undefined | Record<string, 'ok' | 'missing' | 'unknown'>,
    }
  })

  // Verification happens when a niche is CHOSEN, not here. Checking every
  // speculative name would be 20+ requests into a host that is already
  // throttling us, and would return 'unknown' for all of them.
  for (const p of plans) onProgress?.({ stage: 'niche', niche: p })
  onProgress?.({ stage: 'done', detail: `${plans.length} niches proposed` })
  return plans
}

// --- orchestrate ------------------------------------------------------------

export async function runScan(
  opts: ScanOptions,
  log: Log,
  signal?: AbortSignal,
  onProgress?: Progress,
): Promise<ScanResult> {
  let signals: RawSignal[]
  if (opts.useCorpus) {
    log('reading corpus…')
    let corpus = loadCorpus()
    if (!corpus.length) {
      throw new Error('Corpus is empty — run the collector first (npm run collect).')
    }
    const done = loadKnowledge().posts
    const totalInCorpus = corpus.length

    const want = (opts.corpusFilter ?? []).map((x) => x.toLowerCase()).filter(Boolean)
    let pool = corpus
    if (want.length) {
      pool = corpus.filter((e) => {
        const sub = /\/r\/([^/]+)/.exec(e.url ?? '')?.[1]?.toLowerCase()
        return want.includes(e.source.toLowerCase()) || (sub ? want.includes(sub) : false)
      })
      log(`filter [${want.join(', ')}] — ${pool.length} of ${corpus.length} posts match`)
      if (!pool.length) throw new Error('No corpus posts match that filter.')
    }
    // Scoring is free computation over cached classifications, so every
    // matching post goes down the pipeline. Only the UNREAD ones are capped —
    // otherwise a fully-classified corpus could never be re-scored, and the
    // cost cap would be spent on posts that cost nothing.
    const isDone = (e: CorpusEntry) => !!done[postKey(e.source, e.externalId)]
    const cached = pool.filter(isDone)
    const fresh = pool
      .filter((e) => !isDone(e))
      .sort((a, b) => b.firstSeenAt - a.firstSeenAt)
    const take = opts.corpusLimit ? fresh.slice(0, opts.corpusLimit) : fresh
    signals = [...cached, ...take]
    log(
      `${totalInCorpus} in corpus · ${cached.length} already read · ` +
        `${take.length} new to classify${fresh.length > take.length ? ` (${fresh.length - take.length} held back by the cap)` : ''}`,
    )
  } else {
    log('collecting…')
    signals = await collect(opts, log, signal)
    log(`collected ${signals.length} unique signals`)
  }
  if (!signals.length) {
    throw new Error(
      opts.useCorpus
        ? 'No corpus posts match that filter — collect some first.'
        : 'No signals to classify.',
    )
  }

  // Crossposts and reposts are one person saying one thing. Counting them
  // separately inflates demand for whatever gets shared around most.
  const dupes = countDuplicates(signals)
  if (dupes > 0) {
    signals = dedupePosts(signals)
    log(`dropped ${dupes} crosspost${dupes === 1 ? '' : 's'} — ${signals.length} distinct`)
  }

  log('classifying…')
  const outcome = await classifyAll(signals, log, signal, onProgress, opts.demandOnly)
  const classified = outcome.rows

  const categories: Record<string, number> = {}
  for (const { c } of classified) categories[c.category] = (categories[c.category] ?? 0) + 1
  log(
    'categories: ' +
      Object.entries(categories)
        .map(([k, v]) => `${k}=${v}`)
        .join('  '),
  )

  log('scoring…')
  let refuted = opts.refutedTools ?? {}
  const gaps: Record<string, string> = { ...(opts.refutedGaps ?? {}) }
  const nRef = Object.keys(refuted).length
  if (nRef) log(`${nRef} topic${nRef === 1 ? '' : 's'} carry QA-known incumbents — counted as saturation`)
  const { scored: initialScored, distinct, singletons, topicInput } = scoreTopics(
    classified,
    opts.minTopicPosts,
    refuted,
    gaps,
  )
  let scored = initialScored
  log(`${distinct} distinct topics, ${scored.length} scoreable (>=${opts.minTopicPosts} posts)`)

  // The Skeptic is the honest saturation signal. Forum posts cannot reveal
  // incumbents nobody typed — somebody asking "what do you use for X" names
  // nothing, which the old formula read as a wide-open gap. Challenge every
  // scoreable topic with world knowledge, then re-score with the verdicts
  // folded in. Verdicts are cached per topic, so this costs one Sonnet call
  // per NEW topic, not per scan.
  if (opts.challenge && scored.length && !signal?.aborted) {
    log('challenging scoreable topics — do incumbents already exist?')
    const res = await opts.challenge(scored, log)
    Object.assign(refuted, res.tools)
    Object.assign(gaps, res.gaps)
    scored = scoreTopics(classified, opts.minTopicPosts, refuted, gaps).scored
    log('re-scored with QA-known incumbents folded into saturation')
  }

  log('clustering…')
  const themes = signal?.aborted ? [] : await clusterThemes(topicInput)
  log(`${themes.length} themes`)

  log('synthesizing profitable niches…')
  const niches = signal?.aborted ? [] : await synthesizeNiches(scored, log)
  log(`${niches.length} niche suggestion${niches.length === 1 ? '' : 's'}`)

  const result: ScanResult = {
    finishedAt: new Date().toISOString(),
    cancelled: !!signal?.aborted,
    collected: signals.length,
    classified: classified.length,
    distinctTopics: distinct,
    categories,
    singletonTopics: singletons,
    learning: {
      fromCache: outcome.fromCache,
      billed: outcome.billed,
      reusedTopic: outcome.reusedTopic,
      newTopic: outcome.newTopic,
      vocabBefore: outcome.vocabBefore,
      vocabAfter: outcome.vocabAfter,
    },
    themes,
    niches,
    topics: scored,
    sources: opts,
  }
  writeResult(result)
  log('done')
  return result
}
