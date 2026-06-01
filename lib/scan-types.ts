import type { ApiPost } from './posts-client'
import { canonicalTopic } from './topics'

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
  score: number       // 0..10, rounded to int
  scoreRaw: number    // exact (for sorting ties)
}

// Score formula — keeps the 0..10 range but log-scales the volume terms so
// the score doesn't saturate the moment a topic crosses a handful of posts.
// Three additive components, all clamped together at 10:
//   volume = log10(1 + total)        × 2.5   — caps growth; 5 posts ≈ 1.95,
//                                              50 posts ≈ 4.27, 500 ≈ 6.77
//   spread = log2(1 + subreddits)    × 0.8   — rewards cross-sub presence
//                                              with diminishing returns
//   signal = (pain + feature)/total  × 3.0   — linear high-intent ratio
// Genuinely top-tier opportunities (50+ posts across 10+ subs, mostly
// pain/feature) approach 10. Mid-tier lands in 4..7. Tiny topics (1-2
// posts) sit below 3. The previous formula `total*1.5 + subs*1.5 + ratio*3`
// saturated at total≥5 and lost all ranking signal above that point.
export function computeOpportunity(posts: TaggedPost[], topic: string): Opportunity {
  let painCount = 0
  let featureCount = 0
  let toolCount = 0
  let otherCount = 0
  const subs = new Set<string>()
  let total = 0
  for (const p of posts) {
    // `topic` is a canonical label; match posts whose raw topic reduces to it.
    if (canonicalTopic(p.topic) !== topic) continue
    total++
    subs.add(p.subreddit)
    switch (p.category) {
      case 'pain_point': painCount++; break
      case 'feature_request': featureCount++; break
      case 'tool_complaint': toolCount++; break
      default: otherCount++
    }
  }
  const ratio = total === 0 ? 0 : (painCount + featureCount) / total
  const volume = Math.log10(1 + total) * 2.5
  const spread = Math.log2(1 + subs.size) * 0.8
  const signal = ratio * 3
  const scoreRaw = Math.min(10, volume + spread + signal)
  return {
    topic,
    total,
    painCount,
    featureCount,
    toolCount,
    otherCount,
    subreddits: Array.from(subs).sort(),
    score: Math.round(scoreRaw),
    scoreRaw,
  }
}

export function scoreColorClass(score: number): string {
  return score >= 7 ? 'text-green-600' : score >= 4 ? 'text-orange-500' : 'text-gray-400'
}
