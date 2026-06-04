import { describe, it, expect } from 'vitest'
import {
  singularizeWord,
  canonicalTopicLabel,
  canonicalTopic,
  canonicalizeVocabulary,
} from './topics'

describe('singularizeWord', () => {
  it('handles regular plurals', () => {
    expect(singularizeWord('tools')).toBe('tool')
    expect(singularizeWord('problems')).toBe('problem')
  })
  it('handles -ies and -es', () => {
    expect(singularizeWord('queries')).toBe('query')
    expect(singularizeWord('libraries')).toBe('library')
    expect(singularizeWord('boxes')).toBe('box')
    expect(singularizeWord('watches')).toBe('watch')
  })
  it('special-cases apis -> api', () => {
    expect(singularizeWord('apis')).toBe('api')
  })
  it('leaves short tokens, -ss words, and exceptions alone', () => {
    expect(singularizeWord('css')).toBe('css')
    expect(singularizeWord('process')).toBe('process')
    expect(singularizeWord('analytics')).toBe('analytics')
    expect(singularizeWord('aws')).toBe('aws')
  })
  it('does not strip the trailing s from singular -us/-is words or false plurals', () => {
    expect(singularizeWord('chaos')).toBe('chaos')
    expect(singularizeWord('antivirus')).toBe('antivirus')
    expect(singularizeWord('virus')).toBe('virus')
    expect(singularizeWord('analysis')).toBe('analysis')
    expect(singularizeWord('focus')).toBe('focus')
    expect(singularizeWord('series')).toBe('series')
    // genuine plurals still singularize
    expect(singularizeWord('teams')).toBe('team')
  })
})

describe('canonicalTopicLabel (no mangling)', () => {
  it('keeps singular -s words intact in multi-word topics', () => {
    expect(canonicalTopicLabel('operational chaos small teams')).toBe('operational chaos small team')
    expect(canonicalTopicLabel('antivirus market positioning')).toBe('antivirus market positioning')
  })
})

describe('canonicalTopicLabel', () => {
  it('lowercases, strips punctuation, collapses whitespace', () => {
    expect(canonicalTopicLabel('  Auth   Problems!! ')).toBe('auth problem')
  })
  it('merges plural and singular forms', () => {
    expect(canonicalTopicLabel('billing issues')).toBe(canonicalTopicLabel('billing issue'))
  })
  it('applies word aliases to merge synonyms', () => {
    // authentication -> auth, issues -> problem
    expect(canonicalTopicLabel('authentication issues')).toBe('auth problem')
    expect(canonicalTopicLabel('auth problems')).toBe('auth problem')
    // cost/price/billing -> pricing
    expect(canonicalTopicLabel('cost confusion')).toBe('pricing confusion')
    expect(canonicalTopicLabel('price confusion')).toBe('pricing confusion')
  })
  it('applies phrase aliases', () => {
    expect(canonicalTopicLabel('sign up flow')).toBe(canonicalTopicLabel('signup flow'))
  })
  it('is idempotent', () => {
    const once = canonicalTopicLabel('Authentication Issues')
    expect(canonicalTopicLabel(once)).toBe(once)
  })
  it('returns empty string for junk', () => {
    expect(canonicalTopicLabel('!!!')).toBe('')
    expect(canonicalTopicLabel('   ')).toBe('')
  })
})

describe('canonicalTopic (null-aware)', () => {
  it('preserves null/empty', () => {
    expect(canonicalTopic(null)).toBeNull()
    expect(canonicalTopic(undefined)).toBeNull()
    expect(canonicalTopic('  ')).toBeNull()
  })
  it('maps a real topic', () => {
    expect(canonicalTopic('Login Issues')).toBe('auth problem')
  })
})

describe('canonicalizeVocabulary', () => {
  it('groups equivalent topics and maps each to a shared canonical label', () => {
    const { canonical, mapping } = canonicalizeVocabulary([
      'auth problems',
      'authentication issues',
      'pricing confusion',
    ])
    // Two of the three collapse together.
    expect(canonical.length).toBe(2)
    expect(mapping['auth problems']).toBe(mapping['authentication issues'])
    expect(mapping['pricing confusion']).not.toBe(mapping['auth problems'])
  })

  it('picks the most frequent original spelling as the display label', () => {
    const counts = new Map([
      ['auth problems', 10],
      ['authentication issues', 2],
    ])
    const { mapping } = canonicalizeVocabulary(
      ['auth problems', 'authentication issues'],
      counts,
    )
    expect(mapping['authentication issues']).toBe('auth problems')
  })

  it('ignores junk topics', () => {
    const { canonical } = canonicalizeVocabulary(['!!!', '   ', 'real topic'])
    expect(canonical).toEqual(['real topic'])
  })
})
