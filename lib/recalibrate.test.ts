import { describe, it, expect } from 'vitest'
import {
  recalibrateWeights,
  buildOutcomeSamples,
  coerceComponents,
  conversionRates,
  funnelTotals,
  whatWorkedGuidance,
  MIN_RECAL_SAMPLES,
  type OutcomeSample,
} from './recalibrate'
import { DEFAULT_ADVANTAGE_WEIGHTS, type AdvantageComponents } from './advantage'
import type { AppEvent, EventEntity, EventKind } from './events'

// ─── helpers ─────────────────────────────────────────────────────────────────

let nextId = 1
function ev(
  kind: EventKind,
  payload: Record<string, unknown> = {},
  entity: EventEntity = 'lead',
): AppEvent {
  return { id: nextId++, entity, entityId: String(nextId), kind, payload, createdAt: Date.now() }
}

const comp = (over: Partial<AdvantageComponents> = {}): AdvantageComponents => ({
  demand: 0.5,
  monetization: 0.5,
  momentum: 0.5,
  whitespace: 0.5,
  fitToYou: 0.5,
  ...over,
})

const sample = (won: boolean, over: Partial<AdvantageComponents> = {}): OutcomeSample => ({
  components: comp(over),
  won,
})

// ─── recalibrateWeights ──────────────────────────────────────────────────────

describe('recalibrateWeights', () => {
  it('returns base unchanged below the sample floor', () => {
    const samples = [sample(true), sample(false)]
    const r = recalibrateWeights(samples)
    expect(r.adjusted).toBe(false)
    expect(r.weights).toEqual(DEFAULT_ADVANTAGE_WEIGHTS)
  })

  it('returns base unchanged when one-sided (no losses)', () => {
    const samples = Array.from({ length: MIN_RECAL_SAMPLES + 2 }, () => sample(true))
    const r = recalibrateWeights(samples)
    expect(r.adjusted).toBe(false)
    expect(r.weights).toEqual(DEFAULT_ADVANTAGE_WEIGHTS)
  })

  it('raises the weight of a component that is higher among winners', () => {
    // Winners have high fitToYou, losers have low fitToYou; everything else equal.
    const samples: OutcomeSample[] = [
      sample(true, { fitToYou: 1 }),
      sample(true, { fitToYou: 1 }),
      sample(true, { fitToYou: 0.9 }),
      sample(false, { fitToYou: 0 }),
      sample(false, { fitToYou: 0 }),
      sample(false, { fitToYou: 0.1 }),
    ]
    const r = recalibrateWeights(samples)
    expect(r.adjusted).toBe(true)
    expect(r.wins).toBe(3)
    expect(r.losses).toBe(3)
    // fitToYou's *share* of total weight should rise vs the default share.
    const before = DEFAULT_ADVANTAGE_WEIGHTS.fitToYou
    expect(r.weights.fitToYou).toBeGreaterThan(before)
    // a non-discriminating component should not rise
    expect(r.weights.demand).toBeLessThanOrEqual(DEFAULT_ADVANTAGE_WEIGHTS.demand + 1e-9)
  })

  it('keeps weights positive and renormalized to the base total', () => {
    const samples: OutcomeSample[] = [
      sample(true, { demand: 1, monetization: 1 }),
      sample(true, { demand: 1, monetization: 0.9 }),
      sample(true, { demand: 0.95 }),
      sample(false, { demand: 0, monetization: 0 }),
      sample(false, { demand: 0.05 }),
      sample(false, { demand: 0 }),
    ]
    const r = recalibrateWeights(samples)
    const total = Object.values(r.weights).reduce((s, w) => s + w, 0)
    const baseTotal = Object.values(DEFAULT_ADVANTAGE_WEIGHTS).reduce((s, w) => s + w, 0)
    expect(total).toBeCloseTo(baseTotal, 6)
    for (const w of Object.values(r.weights)) expect(w).toBeGreaterThan(0)
  })

  it('respects a custom base', () => {
    const base = { demand: 1, monetization: 1, momentum: 1, whitespace: 1, fitToYou: 1 }
    const samples = [sample(true), sample(false)]
    expect(recalibrateWeights(samples, base).weights).toEqual(base)
  })
})

// ─── coerceComponents / buildOutcomeSamples ──────────────────────────────────

describe('coerceComponents', () => {
  it('reads flat fields', () => {
    expect(coerceComponents(comp({ demand: 0.7 }))?.demand).toBe(0.7)
  })
  it('reads a nested components object', () => {
    expect(coerceComponents({ topic: 'x', components: comp({ momentum: 0.3 }) })?.momentum).toBe(0.3)
  })
  it('clamps out-of-range values', () => {
    expect(coerceComponents(comp({ demand: 2, whitespace: -1 }))).toMatchObject({
      demand: 1,
      whitespace: 0,
    })
  })
  it('returns null when a field is missing or non-numeric', () => {
    expect(coerceComponents({ demand: 0.5 })).toBeNull()
    expect(coerceComponents({ ...comp(), demand: 'high' })).toBeNull()
    expect(coerceComponents(null)).toBeNull()
  })
})

describe('buildOutcomeSamples', () => {
  it('maps pursued→won, parked→loss and ignores other events', () => {
    const events = [
      ev('opportunity_pursued', comp({ demand: 0.8 }), 'opportunity'),
      ev('opportunity_parked', comp({ demand: 0.2 }), 'opportunity'),
      ev('draft_sent', { intentType: 'x' }), // ignored
      ev('opportunity_pursued', { topic: 'no components here' }, 'opportunity'), // skipped (invalid)
    ]
    const samples = buildOutcomeSamples(events)
    expect(samples).toHaveLength(2)
    expect(samples[0]).toEqual({ components: comp({ demand: 0.8 }), won: true })
    expect(samples[1].won).toBe(false)
  })

  it('feeds end-to-end into recalibrateWeights', () => {
    const events: AppEvent[] = []
    for (let i = 0; i < 4; i++) events.push(ev('opportunity_pursued', comp({ monetization: 1 }), 'opportunity'))
    for (let i = 0; i < 4; i++) events.push(ev('opportunity_parked', comp({ monetization: 0 }), 'opportunity'))
    const r = recalibrateWeights(buildOutcomeSamples(events))
    expect(r.adjusted).toBe(true)
    expect(r.weights.monetization).toBeGreaterThan(DEFAULT_ADVANTAGE_WEIGHTS.monetization)
  })
})

// ─── conversion analysis ─────────────────────────────────────────────────────

describe('funnelTotals', () => {
  it('counts each lead funnel stage', () => {
    const events = [
      ev('draft_sent'),
      ev('draft_sent'),
      ev('reply'),
      ev('call_booked'),
      ev('conversion'),
      ev('lead_passed'),
      ev('opportunity_pursued', comp(), 'opportunity'), // not a lead → ignored
    ]
    expect(funnelTotals(events)).toEqual({
      draftsSent: 2,
      replies: 1,
      callsBooked: 1,
      conversions: 1,
      passed: 1,
    })
  })
})

describe('conversionRates', () => {
  it('groups by angle, computes rate, drops zero-draft groups, sorts winners first', () => {
    const events = [
      // "advice" angle: 2 sent, 1 converted → 50%
      ev('draft_sent', { intentType: 'advice' }),
      ev('draft_sent', { intentType: 'advice' }),
      ev('conversion', { intentType: 'advice' }),
      // "rec" angle: 4 sent, 1 converted → 25%
      ev('draft_sent', { intentType: 'rec' }),
      ev('draft_sent', { intentType: 'rec' }),
      ev('draft_sent', { intentType: 'rec' }),
      ev('draft_sent', { intentType: 'rec' }),
      ev('conversion', { intentType: 'rec' }),
      // conversion with no prior draft for this angle → dropped (0 drafts)
      ev('conversion', { intentType: 'ghost' }),
    ]
    const rates = conversionRates(events, 'intentType')
    expect(rates.map((r) => r.key)).toEqual(['advice', 'rec'])
    expect(rates[0]).toMatchObject({ key: 'advice', draftsSent: 2, conversions: 1, rate: 0.5 })
    expect(rates[1].rate).toBeCloseTo(0.25)
  })

  it('skips events missing the grouping dimension', () => {
    const events = [ev('draft_sent', { topic: 'seo' }), ev('draft_sent', {})]
    expect(conversionRates(events, 'topic')).toHaveLength(1)
  })
})

describe('whatWorkedGuidance', () => {
  it('returns null when nothing has converted', () => {
    expect(whatWorkedGuidance([ev('draft_sent', { intentType: 'x' })])).toBeNull()
  })
  it('summarizes the top converting angles', () => {
    const events = [
      ev('draft_sent', { intentType: 'advice' }),
      ev('draft_sent', { intentType: 'advice' }),
      ev('conversion', { intentType: 'advice' }),
    ]
    const g = whatWorkedGuidance(events)
    expect(g).toContain('advice')
    expect(g).toContain('50%')
  })
})
