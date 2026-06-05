import { describe, it, expect } from 'vitest'
import { heatOf, ageStr, promoGate, HEAT_GLYPH } from './warm-leads'

describe('heatOf', () => {
  it('bands by score (≥70 hot, ≥40 cooling, else cold)', () => {
    expect(heatOf(92)).toBe('hot')
    expect(heatOf(70)).toBe('hot')
    expect(heatOf(69)).toBe('cooling')
    expect(heatOf(40)).toBe('cooling')
    expect(heatOf(39)).toBe('cold')
    expect(heatOf(0)).toBe('cold')
  })
  it('has a glyph per band', () => {
    expect(HEAT_GLYPH.hot).toBe('●')
    expect(HEAT_GLYPH.cooling).toBe('◑')
    expect(HEAT_GLYPH.cold).toBe('○')
  })
})

describe('ageStr', () => {
  const NOW = 1_700_000_000_000
  it('minutes under an hour (min 1)', () => {
    expect(ageStr(NOW - 18 * 60_000, NOW)).toBe('18m ago')
    expect(ageStr(NOW - 10_000, NOW)).toBe('1m ago')
  })
  it('hours under a day', () => {
    expect(ageStr(NOW - 3 * 3.6e6, NOW)).toBe('3h ago')
  })
  it('days beyond', () => {
    expect(ageStr(NOW - 50 * 3.6e6, NOW)).toBe('2d ago')
  })
})

describe('promoGate', () => {
  it('passes a clean helpful reply', () => {
    expect(promoGate('Switching cost is the real trap — map billing portals first.').flag).toBe(false)
  })
  it('flags links, CTAs, and unprompted product mentions', () => {
    expect(promoGate('check it out at oursite.com').reason).toBe('contains a link')
    expect(promoGate('sign up for the free trial').reason).toBe('contains a CTA')
    expect(promoGate('we built a tool that fixes this').reason).toBe('names a product unprompted')
    expect(promoGate('dm me for details').reason).toBe('contains a CTA')
  })
  it('is empty-safe', () => {
    expect(promoGate('').flag).toBe(false)
    expect(promoGate(null).flag).toBe(false)
  })
})
