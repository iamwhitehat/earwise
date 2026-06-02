// Outcome events (Phase 7 / LEARN). Pure types + helpers shared by the API,
// the recalibration logic, and the UI. DB access lives in lib/events-db.ts.
import type { LeadStatus } from './leads'

export type EventEntity = 'lead' | 'opportunity'

export type EventKind =
  | 'draft_sent'
  | 'reply'
  | 'call_booked'
  | 'conversion'
  | 'lead_passed'
  | 'opportunity_pursued'
  | 'opportunity_parked'
  // Conversation activity (Convert #3) — timing logs only. Deliberately NOT in
  // EVENT_KINDS, so isValidEventKind/loadEvents exclude them from the funnel +
  // recalibration. ('reply' above is reused for genuine inbound replies.)
  | 'msg_outbound'
  | 'follow_up_drafted'
  | 'objection_drafted'

// The outcome/funnel kinds that recalibration + the "what's working" panel read.
export const EVENT_KINDS: EventKind[] = [
  'draft_sent',
  'reply',
  'call_booked',
  'conversion',
  'lead_passed',
  'opportunity_pursued',
  'opportunity_parked',
]

export function isValidEventKind(k: unknown): k is EventKind {
  return typeof k === 'string' && (EVENT_KINDS as string[]).includes(k)
}

export type AppEvent = {
  id: number
  entity: EventEntity
  entityId: string
  kind: EventKind
  payload: Record<string, unknown>
  createdAt: number
}

/** Map a lead status transition to the outcome event it represents (or null
 *  when the status isn't itself an outcome — e.g. 'new'/'contacted'). */
export function statusToEventKind(status: LeadStatus): EventKind | null {
  switch (status) {
    case 'replied':
      return 'reply'
    case 'call':
      return 'call_booked'
    case 'customer':
      return 'conversion'
    case 'passed':
      return 'lead_passed'
    default:
      return null
  }
}

/** Outcome kinds that count as a "win" for recalibration. */
export const WIN_KINDS: ReadonlySet<EventKind> = new Set(['conversion', 'call_booked'])
/** Outcome kinds that count as a "loss". */
export const LOSS_KINDS: ReadonlySet<EventKind> = new Set(['lead_passed', 'opportunity_parked'])
