import { describe, it, expect } from 'vitest'
import { buildAlerts, type AlertInputs } from './alerts'

const base: AlertInputs = {
  accelerating: [],
  leads: { thisWeek: 0, lastWeek: 0 },
  dissatisfaction: [],
}

describe('buildAlerts', () => {
  it('returns nothing for quiet inputs', () => {
    expect(buildAlerts(base)).toEqual([])
  })

  it('emits an acceleration alert per accelerating topic', () => {
    const a = buildAlerts({ ...base, accelerating: [{ topic: 'auth', weeklyCounts: [2, 4, 8] }] })
    expect(a).toHaveLength(1)
    expect(a[0].kind).toBe('acceleration')
    expect(a[0].topic).toBe('auth')
    expect(a[0].message).toContain('2 → 4 → 8')
  })

  it('flags a lead surge only above the base + ratio thresholds', () => {
    expect(buildAlerts({ ...base, leads: { thisWeek: 12, lastWeek: 4 } })).toHaveLength(1)
    expect(buildAlerts({ ...base, leads: { thisWeek: 4, lastWeek: 1 } })).toHaveLength(0) // below min base
    expect(buildAlerts({ ...base, leads: { thisWeek: 6, lastWeek: 6 } })).toHaveLength(0) // no jump
  })

  it('flags dissatisfaction above the minimum, scaling severity', () => {
    const a = buildAlerts({ ...base, dissatisfaction: [{ tool: 'mailchimp', complaints: 7 }, { tool: 'x', complaints: 1 }] })
    expect(a).toHaveLength(1)
    expect(a[0].kind).toBe('sentiment')
    expect(a[0].severity).toBe('high')
  })

  it('orders high severity first', () => {
    const a = buildAlerts({
      accelerating: [{ topic: 't', weeklyCounts: [1, 2, 3] }],
      leads: { thisWeek: 0, lastWeek: 0 },
      dissatisfaction: [{ tool: 'z', complaints: 3 }], // medium
    })
    expect(a[0].severity).toBe('high')
    expect(a[a.length - 1].severity).toBe('medium')
  })
})
