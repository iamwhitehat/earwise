import { describe, it, expect } from 'vitest'
import { buildOpenerUserContent, cleanOpenerText } from './opener'

describe('buildOpenerUserContent', () => {
  const base = {
    author: 'jane',
    subreddit: 'SaaS',
    excerpt: 'I am looking for a tool that handles dunning emails, paid would be fine.',
  }

  it('includes the author, subreddit, and their text', () => {
    const out = buildOpenerUserContent(base)
    expect(out).toContain('u/jane')
    expect(out).toContain('r/SaaS')
    expect(out).toContain('dunning emails')
  })

  it('includes the valueProp with a do-not-pitch guard when provided', () => {
    const out = buildOpenerUserContent({ ...base, valueProp: 'we automate failed-payment recovery' })
    expect(out).toContain('we automate failed-payment recovery')
    expect(out).toMatch(/do NOT pitch/i)
  })

  it('omits the valueProp line when absent', () => {
    const out = buildOpenerUserContent(base)
    expect(out).not.toMatch(/do NOT pitch/i)
  })

  it('mirrors provided buyer-language phrases (capped)', () => {
    const phrases = Array.from({ length: 12 }, (_, i) => `phrase${i}`)
    const out = buildOpenerUserContent({ ...base, phrases })
    expect(out).toContain('phrase0')
    expect(out).toContain('phrase7') // 8th phrase, at the cap
    expect(out).not.toContain('phrase8') // beyond PHRASE_CAP
  })

  it('omits the phrases line when none are given', () => {
    const out = buildOpenerUserContent(base)
    expect(out).not.toMatch(/Recurring phrases/i)
  })

  it('includes topic and intent when present', () => {
    const out = buildOpenerUserContent({ ...base, topic: 'billing', intentType: 'willing-to-pay' })
    expect(out).toContain('billing')
    expect(out).toContain('willing-to-pay')
  })
})

describe('cleanOpenerText', () => {
  it('strips wrapping quotes and backticks', () => {
    expect(cleanOpenerText('"hello there"')).toBe('hello there')
    expect(cleanOpenerText('`code`')).toBe('code')
    expect(cleanOpenerText("  'spaced'  ")).toBe('spaced')
  })
  it('returns null for empty / whitespace-only output', () => {
    expect(cleanOpenerText('   ')).toBeNull()
    expect(cleanOpenerText('')).toBeNull()
    expect(cleanOpenerText('""')).toBeNull()
  })
  it('leaves normal prose untouched', () => {
    expect(cleanOpenerText('Saw your post about dunning — what are you using now?')).toBe(
      'Saw your post about dunning — what are you using now?',
    )
  })
})
