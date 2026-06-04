import { describe, it, expect } from 'vitest'
import {
  pickShape,
  renderShapeDirective,
  selectVoiceSamples,
  renderVoiceAnchor,
  PERSONA_SYSTEM_PROMPT,
  type DraftLength,
} from './voice'

// Deterministic generator: returns each supplied value in turn, then loops.
function seq(...values: number[]): () => number {
  let i = 0
  return () => values[i++ % values.length]
}

describe('PERSONA_SYSTEM_PROMPT', () => {
  it('carries the voice rules verbatim and bans the marketer words', () => {
    expect(PERSONA_SYSTEM_PROMPT).toContain('a peer, not a consultant, coach, or marketer')
    expect(PERSONA_SYSTEM_PROMPT).toContain('Never restate or summarize their problem back')
    expect(PERSONA_SYSTEM_PROMPT).toMatch(/Banned words: leverage, streamline, pain point/)
    expect(PERSONA_SYSTEM_PROMPT).toContain('Output ONLY the message text')
  })
})

describe('pickShape', () => {
  it('never returns "long" when the post is short', () => {
    const shortPost = 'tiny post'
    for (let i = 0; i < 20; i++) {
      const { length } = pickShape(shortPost, seq(i / 20, 0.99, 0.99))
      expect(length).not.toBe('long')
    }
  })

  it('can return "long" once the post is detailed', () => {
    const detailed = 'x'.repeat(700)
    const lengths = new Set<DraftLength>()
    for (let i = 0; i < 40; i++) {
      lengths.add(pickShape(detailed, seq(i / 40, i / 40)).length)
    }
    expect(lengths.has('long')).toBe(true)
  })

  it('is deterministic given a fixed generator', () => {
    const a = pickShape('hi', seq(0.5, 0.1))
    const b = pickShape('hi', seq(0.5, 0.1))
    expect(a).toEqual(b)
  })
})

describe('renderShapeDirective', () => {
  it('names both the chosen length and angle', () => {
    const out = renderShapeDirective({ length: 'one-liner', angle: 'blunt-take' })
    expect(out).toMatch(/Length: one line/)
    expect(out).toMatch(/Angle: open with a blunt/)
    expect(out).toMatch(/never a template/)
  })
})

describe('selectVoiceSamples', () => {
  it('returns [] for no samples', () => {
    expect(selectVoiceSamples([])).toEqual([])
    expect(selectVoiceSamples(null)).toEqual([])
  })

  it('returns the single sample when only one is given', () => {
    expect(selectVoiceSamples(['only one'])).toEqual(['only one'])
  })

  it('picks at most two from a larger set', () => {
    const five = ['a', 'b', 'c', 'd', 'e']
    for (let i = 0; i < 20; i++) {
      const picked = selectVoiceSamples(five, seq(i / 20, (i + 3) / 20, 0.9))
      expect(picked.length).toBeGreaterThanOrEqual(1)
      expect(picked.length).toBeLessThanOrEqual(2)
      for (const p of picked) expect(five).toContain(p)
    }
  })

  it('drops blank entries', () => {
    expect(selectVoiceSamples(['  ', 'real'])).toEqual(['real'])
  })
})

describe('renderVoiceAnchor', () => {
  it('is empty when there are no samples', () => {
    expect(renderVoiceAnchor([])).toBe('')
    expect(renderVoiceAnchor(undefined)).toBe('')
  })

  it('leads with the voice instruction and quotes the samples', () => {
    const out = renderVoiceAnchor(['The tool isn\'t the problem.'])
    expect(out).toMatch(/Write in this person's voice/)
    expect(out).toMatch(/Match their rhythm, not their topics/)
    expect(out).toContain('"The tool isn\'t the problem."')
  })
})
