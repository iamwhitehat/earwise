// Shared digest types — pure, importable by the server builder and the client
// page. Alerts come from lib/alerts.ts; momentum trend from lib/predict.ts.
import type { Alert } from './alerts'
import type { Trend } from './predict'

export type DigestOpportunity = {
  topic: string
  advantage: number
  posts: number
  confirmedSources: string[]
}

export type DigestTrend = {
  topic: string
  weeklyCounts: number[]
  trend: Trend
  projectedNext: number
}

export type DigestLead = {
  author: string
  subreddit: string
  permalink: string
  excerpt: string
  intentType: string
}

export type DigestMove = { move: string; why: string }

export type DigestDraft = {
  to: string
  subreddit: string
  permalink: string
  text: string
}

export type DigestBrief = {
  weekStart: string
  postCount: number
  newOpportunities: DigestOpportunity[]
  acceleratingTrends: DigestTrend[]
  predictions: DigestTrend[]
  freshLeads: DigestLead[]
  alerts: Alert[]
  moves: DigestMove[]
  drafts: DigestDraft[]
}

export type StoredDigest = {
  id: number
  period: string
  brief: DigestBrief
  generatedAt: number
}
