// Pure prompt-assembly for the lead-outreach opener. Separated from
// lib/claude.ts (which is `server-only`) so the prompt building is unit-
// testable in a plain Node/vitest context.

import {
  PERSONA_SYSTEM_PROMPT,
  renderShapeDirective,
  renderVoiceAnchor,
  type DraftShape,
} from './voice'
import { renderVoiceBriefAnchor, type VoiceBrief } from './voice-brief'

// The opener speaks in the same voice as everything else we generate — a real
// person, not a marketer. The rules live in one place (lib/voice.ts).
export const OPENER_SYSTEM_PROMPT = PERSONA_SYSTEM_PROMPT

export type OpenerInput = {
  author: string
  subreddit: string
  excerpt: string
  topic?: string | null
  intentType?: string | null
  /** Optional one-liner about what the user is building. */
  valueProp?: string | null
  /** Top recurring buyer-language phrases to mirror, if available. */
  phrases?: string[]
  /** Learned "what's working" guidance (which angles convert), if available. */
  guidance?: string | null
  /** The founder's own replies, as a voice anchor (loaded in the route). */
  voiceSamples?: string[]
  /** The founder's distilled positioning, to keep the angle consistent (loaded in the route). */
  voiceBrief?: VoiceBrief | null
}

/** Per-draft variation: the chosen length/angle and the 1–2 voice samples to
 *  anchor on. Both are picked by the caller (claude.ts) so this builder stays
 *  pure and deterministic. */
export type OpenerShaping = {
  shape?: DraftShape
  voiceSamples?: string[]
}

const EXCERPT_CAP = 2000
const PHRASE_CAP = 8

/** Build the user-turn content for the opener call. Pure + deterministic. */
export function buildOpenerUserContent(opts: OpenerInput, shaping: OpenerShaping = {}): string {
  const excerpt = (opts.excerpt ?? '').trim().slice(0, EXCERPT_CAP)
  const phrases = (opts.phrases ?? [])
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, PHRASE_CAP)

  const voiceAnchor = renderVoiceAnchor(shaping.voiceSamples)
  const shapeDirective = shaping.shape ? renderShapeDirective(shaping.shape) : ''
  const briefAnchor = renderVoiceBriefAnchor(opts.voiceBrief)

  return (
    `Subreddit: r/${opts.subreddit}\n` +
    `Author: u/${opts.author || 'unknown'}\n` +
    (opts.topic ? `Topic: ${opts.topic}\n` : '') +
    (opts.intentType ? `Intent signal: ${opts.intentType}\n` : '') +
    (opts.valueProp ? `\nWhat I'm building (context only — do NOT pitch it): ${opts.valueProp}\n` : '') +
    (phrases.length > 0
      ? `\nWords real buyers use (borrow this vocabulary where it fits — don't restate their problem): ${phrases.join('; ')}\n`
      : '') +
    (opts.guidance ? `\nWhat has converted before (lean into this angle): ${opts.guidance.trim()}\n` : '') +
    (briefAnchor ? `\n${briefAnchor}\n` : '') +
    `\n--- Their post/comment ---\n${excerpt}\n--- end ---\n` +
    (voiceAnchor ? `\n${voiceAnchor}\n` : '') +
    (shapeDirective ? `\n${shapeDirective}\n` : '') +
    `\nWrite your reply to u/${opts.author || 'them'}.`
  )
}

/** Strip wrapping quotes/backticks and surrounding whitespace from the model
 *  output; return null when nothing usable remains. */
export function cleanOpenerText(raw: string): string | null {
  const cleaned = raw.trim().replace(/^["'`]+|["'`]+$/g, '').trim()
  return cleaned.length > 0 ? cleaned : null
}
