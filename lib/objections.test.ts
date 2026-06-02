import { describe, it, expect } from 'vitest'
import { buildObjectionLibrary } from './objections'

describe('buildObjectionLibrary', () => {
  it('keeps switching/hate quotes, classifies, dedupes, and counts', () => {
    const lib = buildObjectionLibrary([
      { text: 'switched from Mailchimp, too expensive', type: 'switched' },
      { text: 'Switched from Mailchimp, too expensive', type: 'switching' }, // dup (case/space)
      { text: 'I hate how slow the dashboard is', type: 'hate' },
      { text: 'would happily pay for this', type: 'would_pay' }, // not an objection → excluded
    ])
    const exp = lib.find((o) => o.objection.toLowerCase().startsWith('switched from mailchimp'))
    expect(exp?.count).toBe(2)
    expect(exp?.type).toBe('switching')
    expect(lib.some((o) => o.type === 'hate')).toBe(true)
    expect(lib.some((o) => o.objection.includes('pay'))).toBe(false)
  })

  it('treats untyped quotes as generic "other" objections', () => {
    const lib = buildObjectionLibrary([{ text: 'the pricing is confusing' }])
    expect(lib).toHaveLength(1)
    expect(lib[0].type).toBe('other')
  })

  it('drops too-short text and ranks by count then brevity', () => {
    const lib = buildObjectionLibrary([
      { text: 'no', type: 'hate' }, // too short
      { text: 'integration is a nightmare', type: 'hate' },
      { text: 'integration is a nightmare', type: 'hate' },
      { text: 'support never responds to tickets', type: 'hate' },
    ])
    expect(lib.map((o) => o.objection)).toEqual([
      'integration is a nightmare', // count 2 first
      'support never responds to tickets',
    ])
  })

  it('caps to the limit', () => {
    const quotes = Array.from({ length: 20 }, (_, i) => ({ text: `objection number ${i}`, type: 'hate' }))
    expect(buildObjectionLibrary(quotes, 5)).toHaveLength(5)
  })
})
