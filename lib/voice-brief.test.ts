import { describe, it, expect } from 'vitest'
import { buildVoiceInput, normalizeVoiceBrief, renderVoiceBriefAnchor } from './voice-brief'

describe('buildVoiceInput', () => {
  it('includes the profile and the VoC block', () => {
    const out = buildVoiceInput({ vocText: 'RECURRING PHRASES:\n- "drowning in tickets"', profileText: 'Product: a helpdesk' })
    expect(out).toContain('Product: a helpdesk')
    expect(out).toContain('drowning in tickets')
    expect(out).toMatch(/buyers' own words/)
  })

  it('falls back to a placeholder when no profile', () => {
    const out = buildVoiceInput({ vocText: 'x', profileText: '   ' })
    expect(out).toContain('(no profile provided)')
  })
})

describe('normalizeVoiceBrief', () => {
  it('returns null for junk or empty output', () => {
    expect(normalizeVoiceBrief(null)).toBeNull()
    expect(normalizeVoiceBrief('nope')).toBeNull()
    expect(normalizeVoiceBrief({ positioningLine: '', angles: [] })).toBeNull()
  })

  it('keeps a usable brief and drops empty angles', () => {
    const brief = normalizeVoiceBrief({
      positioningLine: 'The fix is intake, not the tool.',
      angles: [
        { angle: 'Intake-first', whyItLands: 'they blame the tool', exactWords: ['phone and text', 'one queue'] },
        { angle: '', whyItLands: 'dropme', exactWords: [] },
      ],
      snippets: [{ label: 'one-liner', text: 'Force everything into one queue first.', sources: ['one queue'] }],
    })
    expect(brief).not.toBeNull()
    expect(brief!.positioningLine).toContain('intake')
    expect(brief!.angles).toHaveLength(1)
    expect(brief!.angles[0].exactWords).toEqual(['phone and text', 'one queue'])
    expect(brief!.snippets[0].label).toBe('one-liner')
  })

  it('caps angles and filters non-string exactWords', () => {
    const brief = normalizeVoiceBrief({
      positioningLine: 'p',
      angles: Array.from({ length: 9 }, (_, i) => ({ angle: `a${i}`, whyItLands: 'w', exactWords: ['ok', 42, null] })),
      snippets: [],
    })
    expect(brief!.angles).toHaveLength(5)
    expect(brief!.angles[0].exactWords).toEqual(['ok'])
  })
})

describe('renderVoiceBriefAnchor', () => {
  it('is empty for null / empty briefs', () => {
    expect(renderVoiceBriefAnchor(null)).toBe('')
    expect(renderVoiceBriefAnchor({ positioningLine: '', angles: [], snippets: [] })).toBe('')
  })

  it('includes positioning + angle titles and the do-not-pitch guard', () => {
    const out = renderVoiceBriefAnchor({
      positioningLine: 'Intake is the problem, not the tool.',
      angles: [
        { angle: 'Intake-first', whyItLands: 'x', exactWords: ['one queue'] },
        { angle: 'Blunt take', whyItLands: 'y', exactWords: [] },
      ],
      snippets: [{ label: 'one-liner', text: 'SHOULD NOT APPEAR', sources: [] }],
    })
    expect(out).toMatch(/Do NOT pitch/)
    expect(out).toContain('Intake is the problem, not the tool.')
    expect(out).toContain('Intake-first')
    expect(out).toContain('Blunt take')
    expect(out).not.toContain('SHOULD NOT APPEAR') // marketing snippets stay out
  })

  it('caps angle titles at 3', () => {
    const out = renderVoiceBriefAnchor({
      positioningLine: 'p',
      angles: Array.from({ length: 6 }, (_, i) => ({ angle: `angle${i}`, whyItLands: 'w', exactWords: [] })),
      snippets: [],
    })
    expect(out).toContain('angle0')
    expect(out).toContain('angle2')
    expect(out).not.toContain('angle3')
  })
})
