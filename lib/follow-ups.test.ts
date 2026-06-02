import { describe, it, expect } from 'vitest'
import {
  isFollowUpDue,
  nextFollowUpAt,
  suggestedNextStep,
  nextSequenceStep,
  dueFollowUps,
  FOLLOW_UP_DELAY_DAYS,
} from './follow-ups'

const NOW = 1_700_000_000_000
const DAY = 86_400_000

describe('isFollowUpDue', () => {
  it('is due only when contacted, scheduled, and past the reminder', () => {
    expect(isFollowUpDue({ status: 'contacted', nextFollowUpAt: NOW - DAY }, NOW)).toBe(true)
    expect(isFollowUpDue({ status: 'contacted', nextFollowUpAt: NOW + DAY }, NOW)).toBe(false) // future
    expect(isFollowUpDue({ status: 'contacted', nextFollowUpAt: null }, NOW)).toBe(false) // unscheduled
    expect(isFollowUpDue({ status: 'replied', nextFollowUpAt: NOW - DAY }, NOW)).toBe(false) // they replied
    expect(isFollowUpDue({ status: 'new', nextFollowUpAt: NOW - DAY }, NOW)).toBe(false)
  })
})

describe('nextFollowUpAt', () => {
  it('schedules +3 days by default', () => {
    expect(nextFollowUpAt(NOW)).toBe(NOW + FOLLOW_UP_DELAY_DAYS * DAY)
    expect(nextFollowUpAt(NOW, 7)).toBe(NOW + 7 * DAY)
  })
})

describe('suggestedNextStep', () => {
  it('walks the sequence by cursor', () => {
    expect(suggestedNextStep({ status: 'contacted', sequenceStep: 0 })).toBe('opener')
    expect(suggestedNextStep({ status: 'contacted', sequenceStep: 1 })).toBe('follow_up_1')
    expect(suggestedNextStep({ status: 'contacted', sequenceStep: 2 })).toBe('follow_up_2')
    expect(suggestedNextStep({ status: 'contacted', sequenceStep: 5 })).toBe('follow_up_2')
  })
  it('switches to the discovery-call ask once they engage', () => {
    expect(suggestedNextStep({ status: 'replied', sequenceStep: 0 })).toBe('discovery_call')
    expect(suggestedNextStep({ status: 'call', sequenceStep: 2 })).toBe('discovery_call')
  })
})

describe('nextSequenceStep', () => {
  it('advances and caps at 3', () => {
    expect(nextSequenceStep(0)).toBe(1)
    expect(nextSequenceStep(2)).toBe(3)
    expect(nextSequenceStep(3)).toBe(3)
    expect(nextSequenceStep(NaN)).toBe(1)
  })
})

describe('dueFollowUps', () => {
  it('filters to due leads, soonest reminder first', () => {
    const leads = [
      { id: 1, status: 'contacted' as const, nextFollowUpAt: NOW - 2 * DAY },
      { id: 2, status: 'contacted' as const, nextFollowUpAt: NOW - 5 * DAY },
      { id: 3, status: 'replied' as const, nextFollowUpAt: NOW - DAY },
      { id: 4, status: 'contacted' as const, nextFollowUpAt: NOW + DAY },
    ]
    expect(dueFollowUps(leads, NOW).map((l) => l.id)).toEqual([2, 1])
  })
})
