import type { SupabaseClient } from '@supabase/supabase-js'
import type { Category } from './categories'
import { fetchTopicSnapshots, computeDirection, type Direction } from './snapshots'
import { canonicalTopic } from './topics'
import { dedupePosts } from './dedup'
import { redditPermalink, type EvidenceRef } from './evidence'
import { crossSourceConfirmation } from './sources/confirmation'
import { whitespaceFromCounts } from './whitespace'

const MAX_POSTS = 10_000
const MAX_DEEP_POSTS = 2_000
const TOP_TOPICS = 30
const TOP_PAIRS = 15
const TOP_TOOLS = 20
const TOOL_TOPICS_CAP = 5
const SWITCH_QUOTES_CAP = 30
// Insights v2: how many top opportunities get full evidence retrieval, and how
// many concrete evidence examples to attach to each.
const TOP_OPPORTUNITIES = 8
const EXAMPLES_PER_OPP = 5

/**
 * Per-opportunity evidence pack (Insights v2). Real demand metrics plus a
 * handful of concrete, link-backed examples the synthesis must cite.
 */
export type OpportunityEvidence = {
  topic: string
  posts: number
  uniqueAuthors: number
  engagement: number // sum of sampled comment counts across the topic's posts
  momentum: Direction
  weeklyCounts: number[]
  subreddits: string[]
  /** Distinct sources confirming this topic (always includes 'reddit'). */
  confirmedSources: string[]
  /** 0..1 monetization signal (would-pay / switching density + B2B lean). */
  monetization: number
  /** 0..1 whitespace (unmet demand + dissatisfaction − saturation). */
  whitespace: number
  examples: EvidenceRef[]
}

export type AggregatedInsightsData = {
  postCount: number
  deepScanCount: number
  topTopics: Array<{ topic: string; count: number }>
  coOccurringPairs: Array<{ a: string; b: string; subs: number }>
  topTools: Array<{
    tool: string
    count: number
    problems: Array<{ category: Category; topic: string | null }>
  }>
  switchQuotes: EvidenceRef[]
  // Topics whose week-over-week growth rate is increasing — strongest early
  // signals. Computed from trend_snapshots, included in the Claude prompt so
  // the synthesis can highlight them.
  acceleratingTopics: Array<{ topic: string; weeklyCounts: number[]; direction: Direction }>
  // Insights v2: evidence-rich packs for the top opportunities.
  opportunities: OpportunityEvidence[]
}

type PostRow = {
  post_id: string
  subreddit: string
  category: Category
  topic: string | null
  title: string
  author: string
  num_comments: number | null
  posted_at: string | null
}

type DeepRow = {
  post_id: string
  subreddit: string
  category: Category
  topic: string | null
  tools: string[] | null
  quotes: unknown
  posted_at: string | null
}

type RawQuote = { text?: string; type?: string }

export async function aggregateInsights(
  db: SupabaseClient,
): Promise<AggregatedInsightsData> {
  // Two parallel reads. Posts query excludes 'other' (noise reduction);
  // deep query includes everything that's been comment-analyzed since the
  // tools/quotes signal is independent of category.
  const [postsRes, deepRes] = await Promise.all([
    db
      .from('posts')
      .select('post_id, subreddit, category, topic, title, author, num_comments, posted_at')
      .neq('category', 'other')
      .order('analyzed_at', { ascending: false })
      .limit(MAX_POSTS),
    db
      .from('posts')
      .select('post_id, subreddit, category, topic, tools, quotes, posted_at')
      .not('comments_scanned_at', 'is', null)
      .order('analyzed_at', { ascending: false })
      .limit(MAX_DEEP_POSTS),
  ])

  if (postsRes.error) throw new Error(`Posts query failed: ${postsRes.error.message}`)
  if (deepRes.error) throw new Error(`Deep-scans query failed: ${deepRes.error.message}`)

  // Drop crossposts/near-duplicates before any counting.
  const posts = dedupePosts((postsRes.data ?? []) as PostRow[])
  const deep = (deepRes.data ?? []) as DeepRow[]

  const topTopics = computeTopTopics(posts)
  // Fetch snapshots once for the top topics; reused for both accelerator
  // detection and per-opportunity momentum. Plus cross-source confirmation.
  const [snapshotsByTopic, confirmation] = await Promise.all([
    fetchSnapshotsSafe(db, topTopics.map((t) => t.topic)),
    crossSourceConfirmation(db),
  ])
  const acceleratingTopics = detectAcceleratingTopics(topTopics, snapshotsByTopic)
  const opportunities = buildOpportunities(posts, deep, snapshotsByTopic, confirmation)

  return {
    postCount: posts.length,
    deepScanCount: deep.length,
    topTopics,
    coOccurringPairs: computeCoOccurrence(posts),
    topTools: computeTopTools(deep),
    switchQuotes: collectSwitchQuotes(deep),
    acceleratingTopics,
    opportunities,
  }
}

async function fetchSnapshotsSafe(
  db: SupabaseClient,
  topics: string[],
): Promise<Record<string, number[]>> {
  if (topics.length === 0) return {}
  try {
    const map = await fetchTopicSnapshots(db, topics, 8)
    const out: Record<string, number[]> = {}
    for (const topic of topics) out[topic] = (map[topic] ?? []).map((s) => s.postCount)
    return out
  } catch (err) {
    // Snapshots table may not exist yet — degrade gracefully.
    console.warn('[insights] snapshot fetch failed:', err)
    return {}
  }
}

function detectAcceleratingTopics(
  topTopics: Array<{ topic: string }>,
  snapshotsByTopic: Record<string, number[]>,
): AggregatedInsightsData['acceleratingTopics'] {
  const out: AggregatedInsightsData['acceleratingTopics'] = []
  for (const { topic } of topTopics) {
    const counts = snapshotsByTopic[topic] ?? []
    const dir = computeDirection(counts)
    if (dir === 'accelerating') out.push({ topic, weeklyCounts: counts, direction: dir })
  }
  return out
}

// Build evidence-rich packs for the top opportunities: demand metrics computed
// from the (deduped) post set + concrete examples (recent post titles and the
// strongest deep-scan quotes) each carrying a real permalink.
function buildOpportunities(
  posts: PostRow[],
  deep: DeepRow[],
  snapshotsByTopic: Record<string, number[]>,
  confirmation: Record<string, string[]>,
): OpportunityEvidence[] {
  type Agg = {
    posts: PostRow[]
    authors: Set<string>
    subs: Set<string>
    engagement: number
    toolComplaintPosts: number
    featurePosts: number
  }
  const byTopic = new Map<string, Agg>()
  for (const p of posts) {
    const topic = canonicalTopic(p.topic)
    if (!topic) continue
    let e = byTopic.get(topic)
    if (!e) {
      e = {
        posts: [],
        authors: new Set(),
        subs: new Set(),
        engagement: 0,
        toolComplaintPosts: 0,
        featurePosts: 0,
      }
      byTopic.set(topic, e)
    }
    e.posts.push(p)
    if (p.author) e.authors.add(p.author.toLowerCase())
    e.subs.add(p.subreddit)
    if (typeof p.num_comments === 'number') e.engagement += p.num_comments
    if (p.category === 'tool_complaint') e.toolComplaintPosts++
    else if (p.category === 'feature_request') e.featurePosts++
  }

  // Deep-scan stats per canonical topic: drives whitespace + monetization.
  type DeepStats = {
    deepCount: number
    deepDemand: number
    deepDemandNoTool: number
    hateQuotes: number
    wouldPay: number
    switched: number
    distinctTools: Set<string>
  }
  const deepStats = new Map<string, DeepStats>()
  for (const d of deep) {
    const topic = canonicalTopic(d.topic)
    if (!topic) continue
    let s = deepStats.get(topic)
    if (!s) {
      s = { deepCount: 0, deepDemand: 0, deepDemandNoTool: 0, hateQuotes: 0, wouldPay: 0, switched: 0, distinctTools: new Set() }
      deepStats.set(topic, s)
    }
    s.deepCount++
    const tools = Array.isArray(d.tools) ? d.tools : []
    for (const t of tools) if (typeof t === 'string' && t.trim()) s.distinctTools.add(t.trim().toLowerCase())
    if (d.category === 'pain_point' || d.category === 'feature_request') {
      s.deepDemand++
      if (tools.length === 0) s.deepDemandNoTool++
    }
    if (Array.isArray(d.quotes)) {
      for (const raw of d.quotes as RawQuote[]) {
        if (!raw || typeof raw.type !== 'string') continue
        if (raw.type === 'hate') s.hateQuotes++
        else if (raw.type === 'would_pay') s.wouldPay++
        else if (raw.type === 'switched') s.switched++
      }
    }
  }

  // Map canonical topic -> a couple of strong deep-scan quotes (with links).
  const deepQuotesByTopic = new Map<string, EvidenceRef[]>()
  for (const d of deep) {
    const topic = canonicalTopic(d.topic)
    if (!topic || !Array.isArray(d.quotes)) continue
    const list = deepQuotesByTopic.get(topic) ?? []
    if (list.length >= 2) continue
    for (const raw of d.quotes as RawQuote[]) {
      if (!raw || typeof raw.text !== 'string') continue
      const text = raw.text.trim()
      if (!text) continue
      list.push({
        quote: text,
        url: redditPermalink(d.subreddit, d.post_id),
        source: 'reddit',
        subreddit: d.subreddit,
        postedAt: d.posted_at ? new Date(d.posted_at).getTime() : null,
      })
      if (list.length >= 2) break
    }
    deepQuotesByTopic.set(topic, list)
  }

  return Array.from(byTopic.entries())
    .sort((a, b) => b[1].posts.length - a[1].posts.length)
    .slice(0, TOP_OPPORTUNITIES)
    .map(([topic, e]) => {
      const examples: EvidenceRef[] = []
      // Strongest deep-scan quotes first, then recent post titles to fill.
      for (const q of deepQuotesByTopic.get(topic) ?? []) {
        if (examples.length >= EXAMPLES_PER_OPP) break
        examples.push(q)
      }
      for (const p of e.posts) {
        if (examples.length >= EXAMPLES_PER_OPP) break
        const title = (p.title ?? '').trim()
        if (!title) continue
        examples.push({
          quote: title,
          url: redditPermalink(p.subreddit, p.post_id),
          source: 'reddit',
          subreddit: p.subreddit,
          postedAt: p.posted_at ? new Date(p.posted_at).getTime() : null,
        })
      }
      // Opportunities come from Reddit posts, so 'reddit' is always present;
      // union any other sources that confirm the same canonical topic.
      const confirmedSources = Array.from(
        new Set(['reddit', ...(confirmation[topic] ?? [])]),
      ).sort()
      const total = e.posts.length
      const s = deepStats.get(topic)
      const whitespace = whitespaceFromCounts({
        total,
        toolComplaintPosts: e.toolComplaintPosts,
        deepCount: s?.deepCount ?? 0,
        deepDemand: s?.deepDemand ?? 0,
        deepDemandNoTool: s?.deepDemandNoTool ?? 0,
        hateQuotes: s?.hateQuotes ?? 0,
        distinctTools: s?.distinctTools.size ?? 0,
      })
      const deepCount = s?.deepCount ?? 0
      const quoteDensity =
        deepCount > 0 ? ((s?.wouldPay ?? 0) + 0.6 * (s?.switched ?? 0)) / deepCount : 0
      const b2bHint = (e.toolComplaintPosts + e.featurePosts) / Math.max(1, total)
      const monetization = Math.min(1, 0.7 * quoteDensity + 0.3 * b2bHint)
      return {
        topic,
        posts: total,
        uniqueAuthors: e.authors.size,
        engagement: e.engagement,
        momentum: computeDirection(snapshotsByTopic[topic] ?? []),
        weeklyCounts: snapshotsByTopic[topic] ?? [],
        subreddits: Array.from(e.subs).sort(),
        confirmedSources,
        monetization,
        whitespace,
        examples,
      }
    })
}

function computeTopTopics(posts: PostRow[]) {
  const counts = new Map<string, number>()
  for (const p of posts) {
    const topic = canonicalTopic(p.topic)
    if (!topic) continue
    counts.set(topic, (counts.get(topic) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([topic, count]) => ({ topic, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_TOPICS)
}

// Sub-cohort co-occurrence: for each pair of distinct topics (A, B), count
// the number of subreddits where both have ≥1 post. This is the "users in
// the same forum care about both" signal — cheaper and noisier than per-post
// pairing (a post has one topic), but it captures the cross-topic adjacency
// the user actually wants surfaced.
function computeCoOccurrence(posts: PostRow[]) {
  const subToTopics = new Map<string, Set<string>>()
  for (const p of posts) {
    const topic = canonicalTopic(p.topic)
    if (!topic) continue
    let s = subToTopics.get(p.subreddit)
    if (!s) {
      s = new Set()
      subToTopics.set(p.subreddit, s)
    }
    s.add(topic)
  }
  const pairCounts = new Map<string, number>()
  for (const topics of subToTopics.values()) {
    const arr = Array.from(topics).sort()
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const key = `${arr[i]} ${arr[j]}`
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1)
      }
    }
  }
  return Array.from(pairCounts.entries())
    .filter(([, subs]) => subs >= 2) // a pair seen in only 1 sub is not really "co-occurring"
    .map(([key, subs]) => {
      const [a, b] = key.split(' ')
      return { a, b, subs }
    })
    .sort((x, y) => y.subs - x.subs)
    .slice(0, TOP_PAIRS)
}

function computeTopTools(deep: DeepRow[]) {
  type ToolEntry = {
    count: number
    // Deduped (category, topic) pairs across all posts mentioning this tool.
    problems: Map<string, { category: Category; topic: string | null }>
  }
  const tools = new Map<string, ToolEntry>()
  for (const p of deep) {
    if (!Array.isArray(p.tools)) continue
    for (const raw of p.tools) {
      if (typeof raw !== 'string') continue
      const tool = raw.trim().toLowerCase()
      if (!tool) continue
      let entry = tools.get(tool)
      if (!entry) {
        entry = { count: 0, problems: new Map() }
        tools.set(tool, entry)
      }
      entry.count++
      const canonical = canonicalTopic(p.topic)
      const key = `${p.category} ${canonical ?? ''}`
      if (!entry.problems.has(key)) {
        entry.problems.set(key, { category: p.category, topic: canonical })
      }
    }
  }
  return Array.from(tools.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, TOP_TOOLS)
    .map(([tool, entry]) => ({
      tool,
      count: entry.count,
      problems: Array.from(entry.problems.values()).slice(0, TOOL_TOPICS_CAP),
    }))
}

function collectSwitchQuotes(deep: DeepRow[]): EvidenceRef[] {
  const out: EvidenceRef[] = []
  for (const p of deep) {
    if (!Array.isArray(p.quotes)) continue
    for (const raw of p.quotes as RawQuote[]) {
      if (typeof raw !== 'object' || raw === null) continue
      if (raw.type !== 'switched') continue
      if (typeof raw.text !== 'string') continue
      const text = raw.text.trim()
      if (text.length === 0) continue
      out.push({
        quote: text,
        url: redditPermalink(p.subreddit, p.post_id),
        source: 'reddit',
        subreddit: p.subreddit,
        postedAt: p.posted_at ? new Date(p.posted_at).getTime() : null,
      })
      if (out.length >= SWITCH_QUOTES_CAP) return out
    }
  }
  return out
}

// Render the aggregated data into a tight text block for Claude. We list
// concrete numbers because the synthesis prompt asks the model to cite them.
export function renderAggregatedForClaude(data: AggregatedInsightsData): string {
  const lines: string[] = []
  lines.push(`${data.postCount} classified posts (excluding 'other') analyzed.`)
  lines.push(`${data.deepScanCount} posts deep-scanned for comment-level signals.`)
  lines.push('')

  if (data.opportunities.length > 0) {
    lines.push('TOP OPPORTUNITIES — write one insight per opportunity below.')
    lines.push('Cite these exact numbers in `demand` and quote the evidence with its permalink.')
    lines.push('')
    for (const o of data.opportunities) {
      lines.push(
        `### ${o.topic} — demand: ${o.posts} posts, ${o.uniqueAuthors} unique authors, ` +
          `engagement ${o.engagement}; momentum: ${o.momentum}` +
          (o.weeklyCounts.length > 0 ? ` (weekly: ${o.weeklyCounts.join(' → ')})` : '') +
          `; subs: ${o.subreddits.slice(0, 6).map((s) => `r/${s}`).join(', ')}` +
          `; confirmed in ${o.confirmedSources.length} source(s): ${o.confirmedSources.join(', ')}`,
      )
      for (const ex of o.examples) {
        lines.push(`  - "${ex.quote}" — ${ex.url}`)
      }
      lines.push('')
    }
  }

  lines.push('TOP TOPICS (count of posts):')
  for (const { topic, count } of data.topTopics) {
    lines.push(`- ${topic}: ${count}`)
  }
  lines.push('')

  if (data.coOccurringPairs.length > 0) {
    lines.push('TOPIC CO-OCCURRENCE (number of subreddits where both topics appear):')
    for (const { a, b, subs } of data.coOccurringPairs) {
      lines.push(`- "${a}" + "${b}": ${subs} subs`)
    }
    lines.push('')
  }

  if (data.topTools.length > 0) {
    lines.push('TOP TOOLS MENTIONED IN COMMENTS (count, associated topics):')
    for (const t of data.topTools) {
      const problems = t.problems
        .map((p) => p.topic ?? p.category)
        .filter(Boolean)
        .slice(0, TOOL_TOPICS_CAP)
        .join(', ')
      lines.push(`- ${t.tool}: ${t.count} mentions${problems ? ` — appears with: ${problems}` : ''}`)
    }
    lines.push('')
  }

  if (data.switchQuotes.length > 0) {
    lines.push('SWITCHING QUOTES (people moving between tools — cite the link when you use one):')
    for (const q of data.switchQuotes) {
      lines.push(`- "${q.quote}" (r/${q.subreddit ?? '?'}, ${q.url})`)
    }
    lines.push('')
  }

  if (data.acceleratingTopics.length > 0) {
    lines.push('🚀 ACCELERATING TOPICS (week-over-week growth rate is increasing):')
    for (const t of data.acceleratingTopics) {
      lines.push(`- "${t.topic}": ${t.weeklyCounts.join(' → ')} posts`)
    }
    lines.push('These are the strongest early signals. If your opportunity touches one, call it out and flag it as accelerating.')
    lines.push('')
  }

  return lines.join('\n')
}
