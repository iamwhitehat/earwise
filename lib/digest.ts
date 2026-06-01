// Weekly "State of your market" digest builder (Phase 6). Assembles new
// opportunities, accelerating trends, predictive momentum, fresh high-intent
// leads, early-warning alerts, the 3 moves, and ready-to-send drafts; persists
// to `digests`. Server-only (Supabase + Claude).
import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { aggregateInsights } from './insights-aggregator'
import { isoWeekStart, dateToYmd } from './snapshots'
import { predictMomentum } from './predict'
import { buildAlerts, type Alert } from './alerts'
import { INTENT_PATTERNS, findFirstMatch } from './intent-patterns'
import {
  draftSignalReply,
  synthesizeWeeklyMoves,
  SYNTH_MODELS,
  DEFAULT_SYNTH_TIER,
} from './claude'
import { memoryDigest } from './memory-db'
import { DEFAULT_PROJECT } from './memory'
import type {
  DigestBrief,
  DigestOpportunity,
  DigestTrend,
  DigestLead,
  DigestDraft,
} from './digest-types'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const FRESH_LEADS = 8
const DRAFTS = 3
const TOP_OPPS = 6

function buildOrFilter(columns: string[], phrases: string[]): string {
  const clauses: string[] = []
  for (const phrase of phrases) {
    const safe = phrase.replace(/[*(),]/g, '')
    for (const col of columns) clauses.push(`${col}.ilike.*${safe}*`)
  }
  return clauses.join(',')
}

const PHRASES = INTENT_PATTERNS.map((p) => p.phrase)

async function fetchFreshLeads(db: SupabaseClient, sinceIso: string): Promise<DigestLead[]> {
  const [postsRes, commentsRes] = await Promise.all([
    db
      .from('posts')
      .select('post_id, subreddit, author, title, selftext, analyzed_at')
      .or(buildOrFilter(['title', 'selftext'], PHRASES))
      .gte('analyzed_at', sinceIso)
      .order('analyzed_at', { ascending: false })
      .limit(60),
    db
      .from('post_comments')
      .select('comment_id, post_id, subreddit, author, body, analyzed_at')
      .or(buildOrFilter(['body'], PHRASES))
      .gte('analyzed_at', sinceIso)
      .order('analyzed_at', { ascending: false })
      .limit(60),
  ])

  const leads: DigestLead[] = []
  for (const r of postsRes.data ?? []) {
    const text = `${r.title as string}\n${(r.selftext as string | null) ?? ''}`
    const m = findFirstMatch(text)
    if (!m) continue
    const sub = r.subreddit as string
    const id = r.post_id as string
    leads.push({
      author: (r.author as string) || 'unknown',
      subreddit: sub,
      permalink: `https://www.reddit.com/r/${sub}/comments/${id}/`,
      excerpt: text.trim().slice(0, 280),
      intentType: m.intentType,
    })
  }
  for (const r of commentsRes.data ?? []) {
    const body = (r.body as string | null) ?? ''
    const m = findFirstMatch(body)
    if (!m) continue
    const sub = r.subreddit as string
    leads.push({
      author: (r.author as string) || 'unknown',
      subreddit: sub,
      permalink: `https://www.reddit.com/r/${sub}/comments/${r.post_id as string}/`,
      excerpt: body.trim().slice(0, 280),
      intentType: m.intentType,
    })
  }
  return leads.slice(0, FRESH_LEADS)
}

async function priorWeekLeadCount(db: SupabaseClient, fromIso: string, toIso: string): Promise<number> {
  const { count } = await db
    .from('posts')
    .select('post_id', { count: 'exact', head: true })
    .or(buildOrFilter(['title', 'selftext'], PHRASES))
    .gte('analyzed_at', fromIso)
    .lt('analyzed_at', toIso)
  return count ?? 0
}

async function readMaterializedOpps(db: SupabaseClient): Promise<DigestOpportunity[]> {
  const { data, error } = await db
    .from('opportunities')
    .select('canonical_topic, advantage_score, components')
    .eq('project_id', DEFAULT_PROJECT)
    .order('advantage_score', { ascending: false })
    .limit(TOP_OPPS)
  if (error) return []
  return (data ?? []).map((r) => {
    const c = (r.components ?? {}) as Record<string, unknown>
    return {
      topic: r.canonical_topic as string,
      advantage: Number(r.advantage_score) || 0,
      posts: typeof c.posts === 'number' ? c.posts : 0,
      confirmedSources: Array.isArray(c.confirmedSources) ? (c.confirmedSources as string[]) : [],
    }
  })
}

function toTrend(topic: string, weeklyCounts: number[]): DigestTrend {
  const m = predictMomentum(weeklyCounts)
  return { topic, weeklyCounts, trend: m.trend, projectedNext: m.projectedNext }
}

/** Build the weekly digest and persist it. */
export async function buildDigest(
  db: SupabaseClient,
  opts: { model?: string; projectId?: string } = {},
): Promise<DigestBrief> {
  const model = opts.model ?? SYNTH_MODELS[DEFAULT_SYNTH_TIER]
  const projectId = opts.projectId ?? DEFAULT_PROJECT
  const now = Date.now()
  const weekStart = dateToYmd(isoWeekStart(now))
  const weekAgoIso = new Date(now - WEEK_MS).toISOString()
  const twoWeeksAgoIso = new Date(now - 2 * WEEK_MS).toISOString()

  const aggregated = await aggregateInsights(db)

  const newOpportunities = await (async () => {
    const mat = await readMaterializedOpps(db)
    if (mat.length > 0) return mat
    // Fall back to aggregated opportunities (no advantage yet).
    return aggregated.opportunities.slice(0, TOP_OPPS).map(
      (o): DigestOpportunity => ({
        topic: o.topic,
        advantage: 0,
        posts: o.posts,
        confirmedSources: o.confirmedSources,
      }),
    )
  })()

  const acceleratingTrends: DigestTrend[] = aggregated.acceleratingTopics.map((a) =>
    toTrend(a.topic, a.weeklyCounts),
  )

  // Predictive momentum across the top opportunities → topics about to spike.
  const predictions: DigestTrend[] = aggregated.opportunities
    .map((o) => toTrend(o.topic, o.weeklyCounts))
    .filter((t) => t.trend === 'spiking' || t.trend === 'rising')
    .sort((a, b) => (a.trend === 'spiking' ? -1 : 0) - (b.trend === 'spiking' ? -1 : 0))
    .slice(0, 5)

  const freshLeads = await fetchFreshLeads(db, weekAgoIso)
  const lastWeekLeads = await priorWeekLeadCount(db, twoWeeksAgoIso, weekAgoIso)

  // Incumbent-dissatisfaction inputs from tools mentioned alongside complaints.
  const dissatisfaction = aggregated.topTools
    .filter((t) => t.problems.some((p) => p.category === 'tool_complaint'))
    .map((t) => ({ tool: t.tool, complaints: t.count }))
    .slice(0, 5)

  const alerts: Alert[] = buildAlerts({
    accelerating: aggregated.acceleratingTopics.map((a) => ({ topic: a.topic, weeklyCounts: a.weeklyCounts })),
    leads: { thisWeek: freshLeads.length, lastWeek: lastWeekLeads },
    dissatisfaction,
  })

  // Moves (1 Claude call) + drafts (top-3 leads, 3 Claude calls), with memory.
  const digest = await memoryDigest(db, projectId)
  const movesContext = renderMovesContext(newOpportunities, acceleratingTrends, freshLeads)
  const moves = await synthesizeWeeklyMoves(movesContext, model, digest)

  const drafts: DigestDraft[] = []
  for (const lead of freshLeads.slice(0, DRAFTS)) {
    const text = await draftSignalReply({
      subreddit: lead.subreddit,
      author: lead.author,
      text: lead.excerpt,
      intentType: lead.intentType,
    })
    if (text) {
      drafts.push({ to: lead.author, subreddit: lead.subreddit, permalink: lead.permalink, text })
    }
  }

  const brief: DigestBrief = {
    weekStart,
    postCount: aggregated.postCount,
    newOpportunities,
    acceleratingTrends,
    predictions,
    freshLeads,
    alerts,
    moves,
    drafts,
  }

  // Persist (best-effort: a missing table shouldn't lose the computed brief).
  const { error } = await db.from('digests').insert({ project_id: projectId, period: weekStart, brief })
  if (error) console.warn('[digest] persist failed:', error.message)

  return brief
}

function renderMovesContext(
  opps: DigestOpportunity[],
  accelerating: DigestTrend[],
  leads: DigestLead[],
): string {
  const lines: string[] = []
  if (opps.length > 0) {
    lines.push('TOP OPPORTUNITIES:')
    for (const o of opps) lines.push(`- ${o.topic} (${o.posts} posts, confirmed in ${o.confirmedSources.length} sources)`)
    lines.push('')
  }
  if (accelerating.length > 0) {
    lines.push('ACCELERATING TRENDS:')
    for (const a of accelerating) lines.push(`- ${a.topic}: ${a.weeklyCounts.join(' → ')}`)
    lines.push('')
  }
  if (leads.length > 0) {
    lines.push('FRESH HIGH-INTENT LEADS:')
    for (const l of leads.slice(0, 6)) lines.push(`- u/${l.author} in r/${l.subreddit} (${l.intentType}): "${l.excerpt.slice(0, 140)}"`)
  }
  return lines.join('\n')
}
