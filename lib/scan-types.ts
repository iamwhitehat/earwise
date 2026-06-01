import type { ApiPost } from './posts-client'
import { canonicalTopic } from './topics'
import { whitespaceFromCounts, type WhitespaceCounts } from './whitespace'

export const PER_SUB_CAP = 500
export const DONE_FLASH_MS = 1000
export const LAST_SCAN_STORAGE_KEY = 'reddit-reader:last-scan-at'

// Deep scan pulls top-level comments via Reddit's Atom RSS feed, capped at
// this many entries — Reddit's anonymous .json endpoint started returning 403
// in 2023, so this is the only count we can capture without OAuth. The count
// stored on a post row is the size of the sampled slice, NOT the post's true
// comment total. UI labels surface this honestly ("top N sampled").
export const COMMENT_SAMPLE_CAP = 20

export interface TaggedPost extends ApiPost {
  subreddit: string
  index: number // Reddit feed position; ordering uses analyzedAt now, but kept for the legacy API contract
}

// Stage drives the per-sub progress UI. Each stage maps to one status line
// + bar percentage. Set by the client (`fetching`, `failed`) or pushed by
// server stream events (`sizing`, `classifying`, `extracting`, `done`).
export type Stage =
  | { kind: 'fetching' }
  | { kind: 'sizing'; newCount: number; cachedCount: number; backfillCount: number }
  | { kind: 'classifying'; current: number; total: number }
  | { kind: 'extracting'; current: number; total: number }
  | { kind: 'done'; analyzedCount: number; totalCount: number; allCached: boolean }
  | { kind: 'stopped'; analyzedCount: number; totalCount: number }
  | { kind: 'failed'; error: string }

export type SubBucket = {
  sub: string
  posts: TaggedPost[]
  nextAfter: string | null
  loadingMore: boolean
  loadMoreError: string | null
  stage?: Stage
}

export type ScanState =
  | { kind: 'idle' }
  | {
      kind: 'active'
      buckets: Record<string, SubBucket>
      order: string[]
      errors: { sub: string; error: string }[]
    }

export type Trend = { topic: string; count: number; subreddits: string[] }
export type TrendsTab = 'scan' | 'all'

// True while a sub's stream is still producing events. False once the stream
// resolves to any terminal stage ('done', 'failed', or 'stopped'), or once
// the stage is cleared after the done flash. Used to disable the Scan
// button — the Stop button reverts back to Scan once everything terminates.
export function isStreaming(b: SubBucket): boolean {
  if (!b.stage) return false
  return (
    b.stage.kind !== 'done' &&
    b.stage.kind !== 'failed' &&
    b.stage.kind !== 'stopped'
  )
}

export type Opportunity = {
  topic: string
  total: number
  painCount: number
  featureCount: number
  toolCount: number
  otherCount: number
  subreddits: string[]
  engagement: number  // median per-post engagement used in the score (0 when absent)
  whitespace: number  // 0..1 — unmet demand + incumbent dissatisfaction − saturation
  score: number       // 0..10, rounded to int
  scoreRaw: number    // exact (for sorting ties)
}

export type OpportunityMetrics = {
  total: number
  subredditCount: number
  painCount: number
  featureCount: number
  /** Median per-post engagement (upvotes, else sampled comments). 0/undefined
   *  contributes nothing — the score is unchanged until engagement data lands
   *  (e.g. once the OAuth upvote pipeline from Prompt 0b is wired). */
  engagement?: number
}

// Shared scoring used by both the live opportunity cards and the weekly
// snapshot recompute (single source of truth — previously the snapshot
// hard-coded a divergent `posts*1.5 + subs*1.5 + ratio*3`). Four additive,
// log-scaled components clamped together at 10:
//   volume     = log10(1 + total)        × 2.5  — 5 posts ≈ 1.95, 500 ≈ 6.77
//   spread     = log2(1 + subreddits)    × 0.8  — cross-sub reach, diminishing
//   signal     = (pain + feature)/total  × 3.0  — high-intent ratio
//   engagement = log10(1 + medianEng)    × 1.0  — demand intensity; 0 when absent
export const SCORE_WEIGHTS = { volume: 2.5, spread: 0.8, signal: 3.0, engagement: 1.0 } as const

export function scoreOpportunity(m: OpportunityMetrics): { score: number; scoreRaw: number } {
  const ratio = m.total === 0 ? 0 : (m.painCount + m.featureCount) / m.total
  const volume = Math.log10(1 + m.total) * SCORE_WEIGHTS.volume
  const spread = Math.log2(1 + m.subredditCount) * SCORE_WEIGHTS.spread
  const signal = ratio * SCORE_WEIGHTS.signal
  const eng =
    m.engagement && m.engagement > 0
      ? Math.log10(1 + m.engagement) * SCORE_WEIGHTS.engagement
      : 0
  const scoreRaw = Math.min(10, volume + spread + signal + eng)
  return { score: Math.round(scoreRaw), scoreRaw }
}

/** Median of a numeric list (0 for an empty list). */
export function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

// Per-post engagement signal. Upvotes (when the OAuth pipeline provides them)
// outweigh sampled comment counts; returns null when neither is known so the
// value is excluded from the median rather than dragging it toward 0.
function postEngagement(p: TaggedPost): number | null {
  const upvotes = (p as { upvotes?: number | null }).upvotes
  if (typeof upvotes === 'number' && upvotes > 0) return upvotes
  if (typeof p.commentsSampled === 'number' && p.commentsSampled > 0) return p.commentsSampled
  return null
}

export function computeOpportunity(posts: TaggedPost[], topic: string): Opportunity {
  let painCount = 0
  let featureCount = 0
  let toolCount = 0
  let otherCount = 0
  const subs = new Set<string>()
  const engagementValues: number[] = []
  let total = 0
  // Whitespace signals — accumulated over the topic's deep-scanned posts,
  // where tools/quotes (and therefore "is anyone solving this?") are known.
  let deepCount = 0
  let deepDemand = 0
  let deepDemandNoTool = 0
  let hateQuotes = 0
  const distinctTools = new Set<string>()
  for (const p of posts) {
    // `topic` is a canonical label; match posts whose raw topic reduces to it.
    if (canonicalTopic(p.topic) !== topic) continue
    total++
    subs.add(p.subreddit)
    const eng = postEngagement(p)
    if (eng !== null) engagementValues.push(eng)
    switch (p.category) {
      case 'pain_point': painCount++; break
      case 'feature_request': featureCount++; break
      case 'tool_complaint': toolCount++; break
      default: otherCount++
    }

    if (p.commentsScannedAt != null) {
      deepCount++
      const tools = Array.isArray(p.tools) ? p.tools : []
      for (const t of tools) {
        if (typeof t === 'string' && t.trim()) distinctTools.add(t.trim().toLowerCase())
      }
      if (p.category === 'pain_point' || p.category === 'feature_request') {
        deepDemand++
        if (tools.length === 0) deepDemandNoTool++
      }
      if (Array.isArray(p.quotes)) {
        for (const q of p.quotes) {
          if (q && typeof q === 'object' && (q as { type?: string }).type === 'hate') hateQuotes++
        }
      }
    }
  }
  const engagement = median(engagementValues)
  const { score, scoreRaw } = scoreOpportunity({
    total,
    subredditCount: subs.size,
    painCount,
    featureCount,
    engagement,
  })
  const counts: WhitespaceCounts = {
    total,
    toolComplaintPosts: toolCount,
    deepCount,
    deepDemand,
    deepDemandNoTool,
    hateQuotes,
    distinctTools: distinctTools.size,
  }
  return {
    topic,
    total,
    painCount,
    featureCount,
    toolCount,
    otherCount,
    subreddits: Array.from(subs).sort(),
    engagement,
    whitespace: whitespaceFromCounts(counts),
    score,
    scoreRaw,
  }
}

export function scoreColorClass(score: number): string {
  return score >= 7 ? 'text-green-600' : score >= 4 ? 'text-orange-500' : 'text-gray-400'
}
