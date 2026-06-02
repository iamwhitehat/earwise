import { describe, it, expect } from 'vitest'
import {
  LEAD_STATUSES,
  isValidStatus,
  isValidKind,
  leadExternalId,
  normalizeLeadInput,
  mapLeadRow,
  emptyStatusCounts,
} from './leads'

const validSignal = {
  kind: 'post',
  id: 'abc123',
  post_id: 'abc123',
  subreddit: 'SaaS',
  permalink: 'https://www.reddit.com/r/SaaS/comments/abc123/',
  author: 'jane',
  topic: 'billing',
  intentType: 'looking-for',
  category: 'pain_point',
  text: 'I am looking for a tool that handles dunning emails.',
}

describe('status validation', () => {
  it('accepts every defined status', () => {
    for (const s of LEAD_STATUSES) expect(isValidStatus(s)).toBe(true)
  })
  it('rejects unknown / non-string values', () => {
    expect(isValidStatus('won')).toBe(false)
    expect(isValidStatus('')).toBe(false)
    expect(isValidStatus(undefined)).toBe(false)
    expect(isValidStatus(3)).toBe(false)
  })
})

describe('kind validation', () => {
  it('accepts post and comment only', () => {
    expect(isValidKind('post')).toBe(true)
    expect(isValidKind('comment')).toBe(true)
    expect(isValidKind('reply')).toBe(false)
    expect(isValidKind(null)).toBe(false)
  })
})

describe('leadExternalId', () => {
  it('is kind-scoped so post/comment ids never collide', () => {
    expect(leadExternalId('post', 'x')).toBe('post:x')
    expect(leadExternalId('comment', 'x')).toBe('comment:x')
    expect(leadExternalId('post', 'x')).not.toBe(leadExternalId('comment', 'x'))
  })
})

describe('normalizeLeadInput', () => {
  it('accepts a well-formed signal and derives the dedupe key', () => {
    const r = normalizeLeadInput(validSignal)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.lead.external_id).toBe('post:abc123')
    expect(r.lead.source).toBe('reddit')
    expect(r.lead.subreddit).toBe('SaaS')
    expect(r.lead.intent_type).toBe('looking-for')
    expect(r.lead.category).toBe('pain_point')
    expect(r.lead.excerpt).toContain('dunning')
  })

  it('defaults a missing author to "unknown"', () => {
    const r = normalizeLeadInput({ ...validSignal, author: undefined })
    expect(r.ok && r.lead.author).toBe('unknown')
  })

  it('falls back post_id to id when absent', () => {
    const r = normalizeLeadInput({ ...validSignal, post_id: undefined })
    expect(r.ok && r.lead.post_id).toBe('abc123')
  })

  it('nulls optional fields when blank', () => {
    const r = normalizeLeadInput({ ...validSignal, topic: '', intentType: undefined, category: '' })
    if (!r.ok) throw new Error('expected ok')
    expect(r.lead.topic).toBeNull()
    expect(r.lead.intent_type).toBeNull()
    expect(r.lead.category).toBeNull()
  })

  it('rejects an invalid kind', () => {
    const r = normalizeLeadInput({ ...validSignal, kind: 'thread' })
    expect(r.ok).toBe(false)
  })

  it('rejects a missing id', () => {
    const r = normalizeLeadInput({ ...validSignal, id: '' })
    expect(r.ok).toBe(false)
  })

  it('rejects an invalid subreddit', () => {
    expect(normalizeLeadInput({ ...validSignal, subreddit: 'a' }).ok).toBe(false)
    expect(normalizeLeadInput({ ...validSignal, subreddit: 'has space' }).ok).toBe(false)
  })

  it('rejects a non-reddit permalink', () => {
    const r = normalizeLeadInput({ ...validSignal, permalink: 'https://evil.example.com/x' })
    expect(r.ok).toBe(false)
  })

  it('rejects empty text', () => {
    const r = normalizeLeadInput({ ...validSignal, text: '   ' })
    expect(r.ok).toBe(false)
  })
})

describe('mapLeadRow', () => {
  it('maps snake_case columns to the camelCase Lead and tolerates gaps', () => {
    const lead = mapLeadRow({
      id: 7,
      kind: 'comment',
      external_id: 'comment:z',
      subreddit: 'startups',
      status: 'replied',
      created_at: '2026-01-01T00:00:00.000Z',
      last_event_at: '2026-01-02T00:00:00.000Z',
    })
    expect(lead.id).toBe(7)
    expect(lead.kind).toBe('comment')
    expect(lead.externalId).toBe('comment:z')
    expect(lead.status).toBe('replied')
    expect(lead.author).toBe('unknown') // missing column -> fallback
    expect(lead.createdAt).toBeLessThan(lead.lastEventAt)
    expect(lead.disqualified).toBe(false) // missing column -> not disqualified
    expect(lead.disqReason).toBeNull()
  })

  it('coerces an unknown status to "new"', () => {
    expect(mapLeadRow({ id: 1, status: 'bogus' }).status).toBe('new')
  })
})

describe('emptyStatusCounts', () => {
  it('has a zero for every status', () => {
    const c = emptyStatusCounts()
    expect(Object.keys(c).sort()).toEqual([...LEAD_STATUSES].sort())
    expect(Object.values(c).every((n) => n === 0)).toBe(true)
  })
})
