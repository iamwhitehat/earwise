import { describe, it, expect } from 'vitest'
import { predictMomentum } from './predict'

describe('predictMomentum', () => {
  it('handles empty / single-point series', () => {
    expect(predictMomentum([])).toMatchObject({ slope: 0, projectedNext: 0, trend: 'flat' })
    expect(predictMomentum([7])).toMatchObject({ projectedNext: 7, trend: 'flat' })
  })

  it('flags an accelerating series as spiking and projects a jump', () => {
    const m = predictMomentum([2, 4, 8, 16])
    expect(m.trend).toBe('spiking')
    expect(m.spikeLikely).toBe(true)
    expect(m.projectedNext).toBeGreaterThan(16)
  })

  it('does not spike on small-base noise', () => {
    const m = predictMomentum([0, 1, 2]) // accelerating but base too small
    expect(m.spikeLikely).toBe(false)
  })

  it('detects steady rising vs declining', () => {
    expect(predictMomentum([10, 13]).trend).toBe('rising')
    expect(predictMomentum([20, 10]).trend).toBe('declining')
  })

  it('flat when within ±20%', () => {
    expect(predictMomentum([10, 11]).trend).toBe('flat')
  })

  it('projectedNext never goes negative', () => {
    const m = predictMomentum([10, 6, 2])
    expect(m.projectedNext).toBeGreaterThanOrEqual(0)
  })
})
