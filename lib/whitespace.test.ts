import { describe, it, expect } from 'vitest'
import {
  computeWhitespace,
  whitespaceInputsFromCounts,
  whitespaceFromCounts,
  type WhitespaceCounts,
} from './whitespace'

describe('computeWhitespace', () => {
  it('always returns a value in [0,1]', () => {
    for (const u of [0, 0.5, 1]) {
      for (const d of [0, 0.5, 1]) {
        for (const s of [0, 0.5, 1]) {
          const w = computeWhitespace({
            unansweredDemand: u,
            incumbentDissatisfaction: d,
            solutionSaturation: s,
          })
          expect(w).toBeGreaterThanOrEqual(0)
          expect(w).toBeLessThanOrEqual(1)
        }
      }
    }
  })

  it('open space (unmet demand + dissatisfaction, low saturation) scores high', () => {
    const w = computeWhitespace({
      unansweredDemand: 1,
      incumbentDissatisfaction: 1,
      solutionSaturation: 0,
    })
    expect(w).toBeGreaterThan(0.9)
  })

  it('crowded space (high saturation, no unmet demand) scores low', () => {
    const w = computeWhitespace({
      unansweredDemand: 0,
      incumbentDissatisfaction: 0,
      solutionSaturation: 1,
    })
    expect(w).toBeLessThan(0.1)
  })

  it('increases with unmet demand and decreases with saturation', () => {
    const lowDemand = computeWhitespace({ unansweredDemand: 0.2, incumbentDissatisfaction: 0.5, solutionSaturation: 0.3 })
    const highDemand = computeWhitespace({ unansweredDemand: 0.9, incumbentDissatisfaction: 0.5, solutionSaturation: 0.3 })
    expect(highDemand).toBeGreaterThan(lowDemand)

    const lowSat = computeWhitespace({ unansweredDemand: 0.6, incumbentDissatisfaction: 0.5, solutionSaturation: 0.1 })
    const highSat = computeWhitespace({ unansweredDemand: 0.6, incumbentDissatisfaction: 0.5, solutionSaturation: 0.9 })
    expect(highSat).toBeLessThan(lowSat)
  })

  it('clamps out-of-range inputs', () => {
    const w = computeWhitespace({ unansweredDemand: 5, incumbentDissatisfaction: -3, solutionSaturation: 2 })
    expect(w).toBeGreaterThanOrEqual(0)
    expect(w).toBeLessThanOrEqual(1)
  })
})

describe('whitespaceInputsFromCounts', () => {
  it('reports zero unanswered demand when there is no deep evidence', () => {
    const counts: WhitespaceCounts = {
      total: 10,
      toolComplaintPosts: 0,
      deepCount: 0,
      deepDemand: 0,
      deepDemandNoTool: 0,
      hateQuotes: 0,
      distinctTools: 0,
    }
    const inputs = whitespaceInputsFromCounts(counts)
    expect(inputs.unansweredDemand).toBe(0)
    expect(inputs.solutionSaturation).toBe(0)
  })

  it('derives high unmet demand + dissatisfaction, low saturation -> high score', () => {
    const counts: WhitespaceCounts = {
      total: 20,
      toolComplaintPosts: 8,
      deepCount: 10,
      deepDemand: 10,
      deepDemandNoTool: 9,
      hateQuotes: 4,
      distinctTools: 1,
    }
    const inputs = whitespaceInputsFromCounts(counts)
    expect(inputs.unansweredDemand).toBeCloseTo(0.9)
    expect(inputs.solutionSaturation).toBeCloseTo(0.125)
    expect(whitespaceFromCounts(counts)).toBeGreaterThan(0.8)
  })

  it('saturated, well-served space -> low score', () => {
    const counts: WhitespaceCounts = {
      total: 20,
      toolComplaintPosts: 0,
      deepCount: 12,
      deepDemand: 8,
      deepDemandNoTool: 0,
      hateQuotes: 0,
      distinctTools: 12,
    }
    expect(whitespaceFromCounts(counts)).toBeLessThan(0.2)
  })
})
