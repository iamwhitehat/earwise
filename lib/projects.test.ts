import { describe, it, expect } from 'vitest'
import {
  slugify,
  isValidProjectId,
  normalizeProjectName,
  normalizeNiche,
  DEFAULT_PROJECT_ID,
} from './projects'

describe('slugify', () => {
  it('lowercases and dashes non-alphanumerics', () => {
    expect(slugify('AI Coding Tools')).toBe('ai-coding-tools')
    expect(slugify('  Spaced  Out  ')).toBe('spaced-out')
    expect(slugify('Café & Co.')).toBe('caf-co')
  })
  it('never returns empty', () => {
    expect(slugify('')).toBe('project')
    expect(slugify('!!!')).toBe('project')
  })
  it('trims trailing dashes and caps length', () => {
    expect(slugify('end---')).toBe('end')
    expect(slugify('x'.repeat(80)).length).toBeLessThanOrEqual(40)
  })
})

describe('isValidProjectId', () => {
  it('accepts slug-shaped ids including the default', () => {
    expect(isValidProjectId('default')).toBe(true)
    expect(isValidProjectId('ai-coding-tools')).toBe(true)
    expect(isValidProjectId(DEFAULT_PROJECT_ID)).toBe(true)
  })
  it('rejects empties, leading dashes, spaces, and non-strings', () => {
    expect(isValidProjectId('')).toBe(false)
    expect(isValidProjectId('-bad')).toBe(false)
    expect(isValidProjectId('has space')).toBe(false)
    expect(isValidProjectId('UPPER')).toBe(false)
    expect(isValidProjectId(42)).toBe(false)
    expect(isValidProjectId(null)).toBe(false)
  })
})

describe('normalizeProjectName / normalizeNiche', () => {
  it('trims, collapses whitespace, and caps length', () => {
    expect(normalizeProjectName('  My   Idea ')).toBe('My Idea')
    expect(normalizeProjectName(123)).toBe('')
    expect(normalizeProjectName('x'.repeat(200)).length).toBe(80)
    expect(normalizeNiche('  indie   SaaS ')).toBe('indie SaaS')
    expect(normalizeNiche('y'.repeat(200)).length).toBe(160)
  })
})
