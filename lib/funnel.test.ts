import { describe, it, expect } from 'vitest'
import { buildFunnel, funnelLeak } from './funnel'
import type { FunnelTotals } from './recalibrate'

const totals = (over: Partial<FunnelTotals> = {}): FunnelTotals => ({
  draftsSent: 0, replies: 0, callsBooked: 0, conversions: 0, passed: 0, ...over,
})

describe('buildFunnel', () => {
  it('builds Contacted→Replied→Call→Customer with step rates', () => {
    const s = buildFunnel(totals({ draftsSent: 20, replies: 10, callsBooked: 4, conversions: 1 }))
    expect(s.map((x) => x.key)).toEqual(['contacted', 'replied', 'call', 'customer'])
    expect(s[0].rate).toBeNull()
    expect(s[1].rate).toBeCloseTo(0.5)
    expect(s[2].rate).toBeCloseTo(0.4)
    expect(s[3].rate).toBeCloseTo(0.25)
  })

  it('optionally prepends a Signals stage', () => {
    const s = buildFunnel(totals({ draftsSent: 10 }), { signals: 40 })
    expect(s[0]).toMatchObject({ key: 'signals', count: 40, rate: null })
    expect(s[1].rate).toBeCloseTo(0.25) // contacted / signals
  })

  it('flags the single worst leak below threshold (with a real base)', () => {
    // contacted→replied healthy (0.6); replied→call leaks (0.1)
    const s = buildFunnel(totals({ draftsSent: 20, replies: 12, callsBooked: 1, conversions: 0 }))
    expect(s.find((x) => x.leak)?.key).toBe('call')
    expect(s.filter((x) => x.leak)).toHaveLength(1)
    const leak = funnelLeak(s)
    expect(leak?.stage.key).toBe('call')
    expect(leak?.hint).toMatch(/call/i)
  })

  it('does not flag a leak when there is no base (avoids noise)', () => {
    const s = buildFunnel(totals({ draftsSent: 2, replies: 0 }))
    expect(s.some((x) => x.leak)).toBe(false)
    expect(funnelLeak(s)).toBeNull()
  })

  it('does not flag a leak when every step converts healthily', () => {
    const s = buildFunnel(totals({ draftsSent: 10, replies: 8, callsBooked: 6, conversions: 4 }))
    expect(s.some((x) => x.leak)).toBe(false)
  })
})
