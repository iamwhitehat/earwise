// Accumulated knowledge — the part of the system that is supposed to get
// better with use.
//
// Three jobs, in order of how much they matter:
//
//  1. NEVER PAY TWICE. Every classification is cached by post id. A post that
//     has been read once is never sent to the model again, so re-scanning a
//     corpus after adding 100 posts costs 100 posts, not the whole corpus.
//
//  2. REMEMBER THE VOCABULARY. The classifier's real failure mode is inventing
//     a fresh topic string for every post ("searching nginx logs on k8s" vs
//     "log search"), which leaves every topic a singleton and stops the
//     whitespace model from ever running. Feeding back the topics it has
//     already established makes labels collide — which is the whole point.
//
//  3. FORGET THE NOISE. Vocabulary cannot grow without bound or the prompt
//     costs more every run. One-off topics that never recur get pruned; topics
//     that keep appearing are kept.
//
// The measurable claim is the reuse rate: the share of posts labelled with an
// already-known topic. If run 100 is genuinely better than run 1, that number
// climbs. It is reported after every scan so the claim stays falsifiable.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
// Type-only — scan-core imports this module back, so a runtime import here
// would be a cycle. The output dir is resolved independently for the same
// reason.
import type { Classified } from './scan-core'
import { activeDir } from './sessions'

const file = () => new URL('knowledge.json', activeDir())
const VERSION = 1

/** How many known topics to show the classifier. Enough to collide on, small
 *  enough that the prompt stays cheap. */
export const VOCAB_IN_PROMPT = 60

/** Prune below this only when the vocabulary is bigger than this. */
const VOCAB_SOFT_CAP = 400
/** A topic seen once and not seen for this long is noise, not vocabulary. */
const STALE_SINGLETON_MS = 14 * 24 * 60 * 60 * 1000

export type TopicEntry = {
  count: number
  firstSeen: number
  lastSeen: number
  example?: string
}

export type RunStat = {
  at: number
  fromCache: number
  classified: number
  reusedTopic: number
  newTopic: number
}

export type MergeRecord = {
  at: number
  canonical: string
  aliases: string[]
}

export type Knowledge = {
  version: number
  updatedAt: string
  /** raw topic → canonical topic, learned from vocabulary review. Applied to
   *  every future classification, so a merge decided once keeps paying off. */
  aliases: Record<string, string>
  /** Audit trail — a bad merge must be findable, not silent. */
  merges: MergeRecord[]
  /** `source:externalId` → what we decided, so we never re-ask. */
  posts: Record<string, Classified & { at: number }>
  topics: Record<string, TopicEntry>
  tools: Record<string, number>
  /** One entry per scan — the trend line for "is this getting better". */
  runs: RunStat[]
}

export const emptyKnowledge = (): Knowledge => ({
  version: VERSION,
  updatedAt: new Date().toISOString(),
  aliases: {},
  merges: [],
  posts: {},
  topics: {},
  tools: {},
  runs: [],
})

export function loadKnowledge(): Knowledge {
  if (!existsSync(file())) return emptyKnowledge()
  try {
    const k = JSON.parse(readFileSync(file(), 'utf8')) as Knowledge
    if (!k || k.version !== VERSION) return emptyKnowledge()
    return {
      ...emptyKnowledge(),
      ...k,
      aliases: k.aliases ?? {},
      merges: k.merges ?? [],
      posts: k.posts ?? {},
      topics: k.topics ?? {},
      tools: k.tools ?? {},
      runs: k.runs ?? [],
    }
  } catch {
    // A corrupt knowledge file must not cost the user their corpus run.
    return emptyKnowledge()
  }
}

export function saveKnowledge(k: Knowledge): void {
  k.updatedAt = new Date().toISOString()
  writeFileSync(file(), JSON.stringify(k, null, 2))
}

export const postKey = (source: string, externalId: string) => `${source}:${externalId}`

/** The topics worth showing the classifier: strongest first, ties broken by
 *  recency so a shifting corpus is reflected. */
export function vocabulary(k: Knowledge, limit = VOCAB_IN_PROMPT): string[] {
  return Object.entries(k.topics)
    .sort((a, b) => b[1].count - a[1].count || b[1].lastSeen - a[1].lastSeen)
    .slice(0, limit)
    .map(([name]) => name)
}

/** Resolve a raw topic through the learned alias map. */
export function applyAlias(k: Knowledge, topic: string): string {
  return k.aliases[topic] ?? topic
}

/** Record one classification into the cache and the vocabulary.
 *  Returns true when the topic was already known (a reuse). */
export function remember(k: Knowledge, key: string, c: Classified, now: number): boolean {
  // A merge decided in an earlier review applies to everything that follows,
  // which is what makes the review worth paying for once.
  c = { ...c, topic: applyAlias(k, c.topic) }
  k.posts[key] = { ...c, at: now }
  if (!c.topic || c.category === 'other') return false

  const known = !!k.topics[c.topic]
  const t = k.topics[c.topic] ?? { count: 0, firstSeen: now, lastSeen: now }
  t.count++
  t.lastSeen = now
  k.topics[c.topic] = t

  for (const tool of c.tools) {
    if (tool) k.tools[tool] = (k.tools[tool] ?? 0) + 1
  }
  return known
}

/**
 * Drop one-off topics that have not recurred. Only runs once the vocabulary is
 * large, so an early corpus is never pruned back to nothing — and never drops
 * a topic seen more than once, because recurrence is the whole signal.
 */
export function consolidate(k: Knowledge, now: number): number {
  const names = Object.keys(k.topics)
  if (names.length <= VOCAB_SOFT_CAP) return 0
  let dropped = 0
  for (const n of names) {
    const t = k.topics[n]
    if (t.count === 1 && now - t.lastSeen > STALE_SINGLETON_MS) {
      delete k.topics[n]
      dropped++
    }
  }
  return dropped
}

/**
 * Fold a set of aliases into one canonical topic: rewrite every cached post,
 * rebuild the affected counts, and remember the mapping so future
 * classifications land on the canonical name without another review.
 */
export function mergeTopics(
  k: Knowledge,
  canonical: string,
  aliases: string[],
  now: number,
): number {
  const drop = aliases.filter((a) => a && a !== canonical)
  if (!drop.length) return 0
  const set = new Set(drop)

  let moved = 0
  for (const key of Object.keys(k.posts)) {
    const p = k.posts[key]
    if (set.has(p.topic)) {
      p.topic = canonical
      moved++
    }
  }
  if (!moved) return 0

  const target = k.topics[canonical] ?? { count: 0, firstSeen: now, lastSeen: now }
  for (const a of drop) {
    const t = k.topics[a]
    if (!t) continue
    target.count += t.count
    target.firstSeen = Math.min(target.firstSeen, t.firstSeen)
    target.lastSeen = Math.max(target.lastSeen, t.lastSeen)
    delete k.topics[a]
    k.aliases[a] = canonical
  }
  k.topics[canonical] = target
  k.merges.push({ at: now, canonical, aliases: drop })
  if (k.merges.length > 200) k.merges = k.merges.slice(-200)
  return moved
}

/**
 * Reuse rate alone is gameable: it is produced by the same feedback that it
 * measures, so labelling everything "clinical workflow" would score 100%.
 * These two say whether the vocabulary is collapsing.
 *
 *  - effectiveTopics: Herfindahl inverse, 1 / Σ pᵢ². "How many topics are
 *    genuinely in play", insensitive to a long tail of one-offs.
 *  - topShare: the largest topic's share of labelled posts.
 *
 * Rising reuse WITH rising effectiveTopics is real accumulation. Rising reuse
 * with FALLING effectiveTopics is the degenerate case, and must be visible.
 */
export function concentration(k: Knowledge): { effectiveTopics: number; topShare: number } {
  const counts = Object.values(k.topics).map((t) => t.count)
  const total = counts.reduce((a, b) => a + b, 0)
  if (!total) return { effectiveTopics: 0, topShare: 0 }
  const hhi = counts.reduce((a, c) => a + (c / total) ** 2, 0)
  return {
    effectiveTopics: hhi > 0 ? 1 / hhi : 0,
    topShare: Math.max(...counts) / total,
  }
}

export type KnowledgeStats = {
  postsKnown: number
  topicsKnown: number
  toolsKnown: number
  /** Topics seen more than once — the ones that can actually be scored. */
  recurringTopics: number
  runs: RunStat[]
  /** Share of the last run's classifications that reused a known topic. */
  lastReuseRate: number | null
  /** Same, across every run — the trend that answers "better at 100 than 1". */
  reuseTrend: number[]
  /** Collapse guard — see concentration(). */
  effectiveTopics: number
  topShare: number
}

export function knowledgeStats(k: Knowledge): KnowledgeStats {
  const runs = k.runs.slice(-40)
  const rate = (r: RunStat) =>
    r.classified > 0 ? r.reusedTopic / r.classified : 0
  const last = k.runs.length ? k.runs[k.runs.length - 1] : null
  const conc = concentration(k)
  return {
    ...conc,
    postsKnown: Object.keys(k.posts).length,
    topicsKnown: Object.keys(k.topics).length,
    toolsKnown: Object.keys(k.tools).length,
    recurringTopics: Object.values(k.topics).filter((t) => t.count > 1).length,
    runs,
    lastReuseRate: last && last.classified > 0 ? rate(last) : null,
    reuseTrend: runs.map(rate),
  }
}

/** Top topics with their evidence — the "knowledge on demand" read. */
export function topTopics(k: Knowledge, limit = 40) {
  return Object.entries(k.topics)
    .sort((a, b) => b[1].count - a[1].count || b[1].lastSeen - a[1].lastSeen)
    .slice(0, limit)
    .map(([name, t]) => ({ name, ...t }))
}

export function topTools(k: Knowledge, limit = 30) {
  return Object.entries(k.tools)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }))
}
