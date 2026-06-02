// Pure lead-pipeline logic shared by the API routes, the client board, and
// the tests. No `server-only`, no Supabase — keep this importable from a
// plain Node/vitest context.
import type { Tier, ScoreBreakdown } from './lead-score'

export const LEAD_STATUSES = [
  'new',
  'contacted',
  'replied',
  'call',
  'customer',
  'passed',
] as const

export type LeadStatus = (typeof LEAD_STATUSES)[number]

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  replied: 'Replied',
  call: 'Call booked',
  customer: 'Customer',
  passed: 'Passed',
}

export const LEAD_KINDS = ['post', 'comment'] as const
export type LeadKind = (typeof LEAD_KINDS)[number]

export function isValidStatus(s: unknown): s is LeadStatus {
  return typeof s === 'string' && (LEAD_STATUSES as readonly string[]).includes(s)
}

export function isValidKind(k: unknown): k is LeadKind {
  return typeof k === 'string' && (LEAD_KINDS as readonly string[]).includes(k)
}

// Reddit post IDs and comment IDs live in separate namespaces (t3_ vs t1_)
// and their bare base36 forms can collide, so the dedupe key is kind-scoped.
// Used both server-side (insert) and client-side (the Signals "in pipeline"
// membership check) so the two always agree.
export function leadExternalId(kind: LeadKind, id: string): string {
  return `${kind}:${id}`
}

export const EXCERPT_MAX = 4000
const FIELD_MAX = 200

/** Shape the client posts to /api/leads — a SignalRow plus nothing else. */
export type LeadInput = {
  kind: unknown
  id: unknown
  post_id: unknown
  subreddit: unknown
  permalink: unknown
  author?: unknown
  topic?: unknown
  intentType?: unknown
  category?: unknown
  text?: unknown
}

/** A DB-ready leads row (no id / timestamps / status — those default). */
export type NormalizedLead = {
  source: 'reddit'
  kind: LeadKind
  external_id: string
  post_id: string
  subreddit: string
  permalink: string
  author: string
  topic: string | null
  intent_type: string | null
  category: string | null
  excerpt: string
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}
function optStr(v: unknown, max = FIELD_MAX): string | null {
  const s = str(v)
  return s ? s.slice(0, max) : null
}

/**
 * Validate + normalize an incoming SignalRow into a leads row. Returns a
 * discriminated result so callers can map failures to a 400. Permalinks must
 * be reddit.com URLs — the only source we create leads from today, and it
 * keeps a hostile body from injecting an arbitrary outbound link.
 */
export function normalizeLeadInput(
  raw: unknown,
): { ok: true; lead: NormalizedLead } | { ok: false; error: string } {
  const b = (raw ?? {}) as LeadInput

  if (!isValidKind(b.kind)) {
    return { ok: false, error: "Invalid kind (expected 'post' or 'comment')" }
  }
  const id = str(b.id)
  if (!id || id.length > FIELD_MAX) return { ok: false, error: 'Missing or invalid id' }

  const postId = str(b.post_id) || id
  const subreddit = str(b.subreddit)
  if (!subreddit || !/^[a-z0-9_]{2,21}$/i.test(subreddit)) {
    return { ok: false, error: 'Missing or invalid subreddit' }
  }

  const permalink = str(b.permalink)
  if (!/^https:\/\/(www\.)?reddit\.com\//i.test(permalink)) {
    return { ok: false, error: 'Invalid permalink (must be a reddit.com URL)' }
  }

  const excerpt = str(b.text)
  if (!excerpt) return { ok: false, error: 'Missing text' }

  return {
    ok: true,
    lead: {
      source: 'reddit',
      kind: b.kind,
      external_id: leadExternalId(b.kind, id),
      post_id: postId.slice(0, FIELD_MAX),
      subreddit,
      permalink: permalink.slice(0, 500),
      author: optStr(b.author) ?? 'unknown',
      topic: optStr(b.topic),
      intent_type: optStr(b.intentType, 40),
      category: optStr(b.category, 40),
      excerpt: excerpt.slice(0, EXCERPT_MAX),
    },
  }
}

/** The lead shape returned to the client (camelCase, mapped from the row). */
export type Lead = {
  id: number
  source: string
  kind: LeadKind
  externalId: string
  postId: string
  subreddit: string
  permalink: string
  author: string
  topic: string | null
  intentType: string | null
  category: string | null
  excerpt: string
  openerDraft: string | null
  status: LeadStatus
  notes: string | null
  createdAt: number
  lastEventAt: number
  // Convert-core (lead scoring + conversation). Score/tier are computed fresh
  // on read (authoritative) and best-effort persisted; breakdown is attached by
  // the server for the "why hot?" popover and isn't stored.
  leadScore: number | null
  tier: Tier | null
  scoreBreakdown: ScoreBreakdown | null
  nextFollowUpAt: number | null
  sequenceStep: number
  // Combined-gate purge (RELEVANCE-INTENT-GATE-PATCH §6): off-niche / non-buyer
  // leads are flagged (not deleted) and hidden from the default board.
  disqualified: boolean
  disqReason: string | null
}

/** Map a raw Supabase row to the client Lead shape. Tolerant of missing
 *  optional columns so a partially-migrated DB doesn't throw. Accepts
 *  `unknown` because Supabase infers an opaque row type when the column
 *  projection is a runtime string rather than a literal. */
export function mapLeadRow(rowRaw: unknown): Lead {
  const row = (rowRaw ?? {}) as Record<string, unknown>
  const status = row.status
  return {
    id: row.id as number,
    source: (row.source as string) ?? 'reddit',
    kind: (row.kind as LeadKind) ?? 'post',
    externalId: (row.external_id as string) ?? '',
    postId: (row.post_id as string) ?? '',
    subreddit: (row.subreddit as string) ?? '',
    permalink: (row.permalink as string) ?? '',
    author: (row.author as string) || 'unknown',
    topic: (row.topic as string | null) ?? null,
    intentType: (row.intent_type as string | null) ?? null,
    category: (row.category as string | null) ?? null,
    excerpt: (row.excerpt as string) ?? '',
    openerDraft: (row.opener_draft as string | null) ?? null,
    status: isValidStatus(status) ? status : 'new',
    notes: (row.notes as string | null) ?? null,
    createdAt: row.created_at ? new Date(row.created_at as string).getTime() : Date.now(),
    lastEventAt: row.last_event_at
      ? new Date(row.last_event_at as string).getTime()
      : Date.now(),
    leadScore: typeof row.lead_score === 'number' ? row.lead_score : null,
    tier: (row.tier as Tier | null) ?? null,
    scoreBreakdown: null,
    nextFollowUpAt: row.next_follow_up_at
      ? new Date(row.next_follow_up_at as string).getTime()
      : null,
    sequenceStep: typeof row.sequence_step === 'number' ? row.sequence_step : 0,
    disqualified: row.disqualified === true,
    disqReason: (row.disq_reason as string | null) ?? null,
  }
}

export function emptyStatusCounts(): Record<LeadStatus, number> {
  return { new: 0, contacted: 0, replied: 0, call: 0, customer: 0, passed: 0 }
}
