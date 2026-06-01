import { describe, it, expect } from 'vitest'
import { parseClassification, normalizeTopic } from './classify-parse'

describe('parseClassification', () => {
  it('parses a clean JSON reply', () => {
    expect(parseClassification('{"category":"pain_point","confidence":"high"}')).toEqual({
      category: 'pain_point',
      confidence: 'high',
    })
  })
  it('extracts JSON embedded in surrounding text / code fences', () => {
    const text = 'Here you go:\n```json\n{"category":"feature_request","confidence":"medium"}\n```'
    expect(parseClassification(text)).toEqual({
      category: 'feature_request',
      confidence: 'medium',
    })
  })
  it('is case/whitespace tolerant', () => {
    expect(parseClassification('{"category":" Tool_Complaint ","confidence":"LOW"}')).toEqual({
      category: 'tool_complaint',
      confidence: 'low',
    })
  })
  it('falls back to other/medium on invalid category or confidence', () => {
    expect(parseClassification('{"category":"banana","confidence":"sure"}')).toEqual({
      category: 'other',
      confidence: 'medium',
    })
  })
  it('falls back on unparseable text', () => {
    expect(parseClassification('not json at all')).toEqual({
      category: 'other',
      confidence: 'medium',
    })
  })
})

describe('normalizeTopic', () => {
  it('lowercases, strips punctuation, collapses whitespace', () => {
    expect(normalizeTopic('  Auth   Problems! ')).toBe('auth problems')
  })
  it('rejects empty / punctuation-only', () => {
    expect(normalizeTopic('   ')).toBeNull()
    expect(normalizeTopic('!!!')).toBeNull()
  })
  it('rejects too-many-words and over-long labels', () => {
    expect(normalizeTopic('a b c d e f g')).toBeNull() // 7 words
    expect(normalizeTopic('x'.repeat(61))).toBeNull()
  })
  it('accepts a normal 2-4 word label', () => {
    expect(normalizeTopic('cold email deliverability')).toBe('cold email deliverability')
  })
})
