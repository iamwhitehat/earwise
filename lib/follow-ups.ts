// Follow-up + sequence logic (Convert #3). Pure + tested. A lead in `contacted`
// with a due reminder and no reply yet forms the "Needs follow-up" queue; the
// sequence cursor drives the suggested next, human-approved step.
import type { Lead, LeadStatus } from './leads'

export const FOLLOW_UP_DELAY_DAYS = 3
const DAY_MS = 86_400_000

type FollowUpLead = Pick<Lead, 'status' | 'nextFollowUpAt'>

/**
 * Due when the lead is still `contacted` (a recorded reply bumps status to
 * `replied`, so status is our "no inbound yet" proxy) and the reminder time has
 * passed. Leads with no scheduled reminder are not due.
 */
export function isFollowUpDue(lead: FollowUpLead, now: number = Date.now()): boolean {
  return lead.status === 'contacted' && lead.nextFollowUpAt != null && lead.nextFollowUpAt <= now
}

/** The next reminder timestamp after sending a nudge (default +3 days). */
export function nextFollowUpAt(now: number = Date.now(), days: number = FOLLOW_UP_DELAY_DAYS): number {
  return now + days * DAY_MS
}

export type SequenceStep = 'opener' | 'follow_up_1' | 'follow_up_2' | 'discovery_call'

export const SEQUENCE_STEP_LABEL: Record<SequenceStep, string> = {
  opener: 'Send opener',
  follow_up_1: 'Send follow-up #1',
  follow_up_2: 'Send follow-up #2',
  discovery_call: 'Ask for a discovery call',
}

/**
 * The suggested (human-approved, never auto-sent) next step. Status-aware: once
 * they reply (or a call is booked) the move is the discovery-call ask;
 * otherwise the cursor walks opener → follow-up 1 → follow-up 2.
 */
export function suggestedNextStep(opts: { status: LeadStatus; sequenceStep: number }): SequenceStep {
  if (opts.status === 'replied' || opts.status === 'call') return 'discovery_call'
  if (opts.sequenceStep <= 0) return 'opener'
  if (opts.sequenceStep === 1) return 'follow_up_1'
  return 'follow_up_2'
}

/** Advance the sequence cursor, capped at the discovery-call step (3). */
export function nextSequenceStep(step: number): number {
  return Math.min((Number.isFinite(step) ? step : 0) + 1, 3)
}

/** The "Needs follow-up" queue: due leads, soonest reminder first. */
export function dueFollowUps<T extends FollowUpLead>(leads: T[], now: number = Date.now()): T[] {
  return leads
    .filter((l) => isFollowUpDue(l, now))
    .sort((a, b) => (a.nextFollowUpAt ?? 0) - (b.nextFollowUpAt ?? 0))
}
