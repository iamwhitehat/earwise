import type { SupabaseClient } from '@supabase/supabase-js'
import type { Category } from './categories'
import { fetchTopicSnapshots, computeDirection, type Direction } from './snapshots'
import { canonicalTopic } from './topics'
import { dedupePosts } from './dedup'
import { redditPermalink, type EvidenceRef } from './evidence'

const MAX_POSTS = 10_000
const MAX_DEEP_POSTS = 2_000
const TOP_TOPICS = 30
const TOP_PAIRS = 15
const TOP_TOOLS = 20
const TOOL_TOPICS_CAP = 5
const SWITCH_QUOTES_CAP = 30

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
}

type PostRow = {
  post_id: string
  subreddit: string
  category: Category
  topic: string | null
  title: string
  author: string
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
      .select('post_id, subreddit, category, topic, title, author')
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
  // Fetch snapshots for the top topics so the synthesis can flag accelerators.
  // Pull the last 8 weeks; computeDirection only needs the trailing 3.
  const acceleratingTopics = await detectAcceleratingTopics(
    db,
    topTopics.map((t) => t.topic),
  )

  return {
    postCount: posts.length,
    deepScanCount: deep.length,
    topTopics,
    coOccurringPairs: computeCoOccurrence(posts),
    topTools: computeTopTools(deep),
    switchQuotes: collectSwitchQuotes(deep),
    acceleratingTopics,
  }
}

async function detectAcceleratingTopics(
  db: SupabaseClient,
  topics: string[],
): Promise<AggregatedInsightsData['acceleratingTopics']> {
  if (topics.length === 0) return []
  try {
    const map = await fetchTopicSnapshots(db, topics, 8)
    const out: AggregatedInsightsData['acceleratingTopics'] = []
    for (const topic of topics) {
      const snaps = map[topic] ?? []
      const counts = snaps.map((s) => s.postCount)
      const dir = computeDirection(counts)
      if (dir === 'accelerating') out.push({ topic, weeklyCounts: counts, direction: dir })
    }
    return out
  } catch (err) {
    // Snapshots table may not exist yet — degrade gracefully, the rest of
    // the synthesis still works.
    console.warn('[insights] detectAcceleratingTopics failed:', err)
    return []
  }
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
