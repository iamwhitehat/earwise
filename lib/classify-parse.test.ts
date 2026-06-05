import { describe, it, expect } from 'vitest'
import {
  parseClassification,
  normalizeTopic,
  normalizeClassifyExtract,
  normalizeClassifyExtractBatch,
  normalizeTopicsBatch,
} from './classify-parse'

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

describe('normalizeClassifyExtract', () => {
  it('keeps a valid category + confidence + normalized topic', () => {
    expect(
      normalizeClassifyExtract({ category: 'pain_point', confidence: 'high', topic: 'Auth  Problems!' }),
    ).toEqual({ category: 'pain_point', confidence: 'high', topic: 'auth problems' })
  })
  it('forces topic to null when category is other', () => {
    expect(
      normalizeClassifyExtract({ category: 'other', confidence: 'low', topic: 'some topic' }),
    ).toEqual({ category: 'other', confidence: 'low', topic: null })
  })
  it('nulls an unusable topic but keeps the classification', () => {
    expect(
      normalizeClassifyExtract({ category: 'tool_complaint', confidence: 'medium', topic: '!!!' }),
    ).toEqual({ category: 'tool_complaint', confidence: 'medium', topic: null })
  })
  it('falls back to other/medium/null on null or garbage input', () => {
    const fallback = { category: 'other', confidence: 'medium', topic: null }
    expect(normalizeClassifyExtract(null)).toEqual(fallback)
    expect(normalizeClassifyExtract({ category: 'banana', confidence: 'sure' })).toEqual(fallback)
    expect(normalizeClassifyExtract('not an object')).toEqual(fallback)
  })
})

describe('normalizeClassifyExtractBatch', () => {
  const D = { category: 'other', confidence: 'medium', topic: null }

  it('maps each entry to its 1-based index, preserving post order', () => {
    const raw = {
      classifications: [
        { index: 2, category: 'feature_request', confidence: 'medium', topic: 'dark mode' },
        { index: 1, category: 'pain_point', confidence: 'high', topic: 'auth problems' },
      ],
    }
    expect(normalizeClassifyExtractBatch(raw, 2)).toEqual([
      { category: 'pain_point', confidence: 'high', topic: 'auth problems' },
      { category: 'feature_request', confidence: 'medium', topic: 'dark mode' },
    ])
  })

  it('always returns exactly `count` entries, filling omissions with the default', () => {
    const raw = { classifications: [{ index: 2, category: 'pain_point', confidence: 'high', topic: 'billing' }] }
    expect(normalizeClassifyExtractBatch(raw, 3)).toEqual([
      D,
      { category: 'pain_point', confidence: 'high', topic: 'billing' },
      D,
    ])
  })

  it('ignores out-of-range, duplicate, and non-integer indices (never shifts onto the wrong post)', () => {
    const raw = {
      classifications: [
        { index: 0, category: 'pain_point', confidence: 'high', topic: 'x' }, // out of range
        { index: 5, category: 'pain_point', confidence: 'high', topic: 'y' }, // out of range
        { index: '1', category: 'tool_complaint', confidence: 'low', topic: 'slow ci' }, // numeric string ok
        { index: 1, category: 'feature_request', confidence: 'high', topic: 'later dup' }, // dup overwrites idx 0
      ],
    }
    const out = normalizeClassifyExtractBatch(raw, 2)
    expect(out).toHaveLength(2)
    expect(out[1]).toEqual(D)
    // both entries for index 1 are valid; the function applies them in order (last wins)
    expect(out[0]).toEqual({ category: 'feature_request', confidence: 'high', topic: 'later dup' })
  })

  it('returns all-defaults for null / missing-array input', () => {
    expect(normalizeClassifyExtractBatch(null, 2)).toEqual([D, D])
    expect(normalizeClassifyExtractBatch({}, 1)).toEqual([D])
  })
})

describe('normalizeTopicsBatch', () => {
  it('maps topics by index and normalizes them; omissions stay null', () => {
    const raw = { topics: [{ index: 1, topic: 'Cold Email!' }, { index: 3, topic: 'pricing confusion' }] }
    expect(normalizeTopicsBatch(raw, 3)).toEqual(['cold email', null, 'pricing confusion'])
  })
  it('nulls unusable topics and ignores bad indices', () => {
    const raw = { topics: [{ index: 1, topic: '!!!' }, { index: 9, topic: 'oob' }] }
    expect(normalizeTopicsBatch(raw, 2)).toEqual([null, null])
  })
  it('returns all-null for garbage input', () => {
    expect(normalizeTopicsBatch(null, 2)).toEqual([null, null])
  })
})
