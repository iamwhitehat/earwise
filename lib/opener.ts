// Pure prompt-assembly for the lead-outreach opener. Separated from
// lib/claude.ts (which is `server-only`) so the prompt building is unit-
// testable in a plain Node/vitest context.

export const OPENER_SYSTEM_PROMPT = `You write the FIRST direct message to a Reddit user who just described a problem your product solves.

Goal: start a genuine conversation. You are not closing a sale — you are opening a door.

Structure:
1. Open by reflecting their specific problem back, in their own words (mirror their phrasing).
2. One sentence of genuine, specific empathy or insight — show you actually read it.
3. End with ONE soft, low-pressure question that invites a reply.

Rules:
- Lead with their problem. NEVER pitch a product in the first message.
- If a value prop is provided, you may hint at relevant experience, but do not name-drop or link anything.
- Plain conversational prose. No markdown, no greetings like "Hey there!", no sign-off.
- Under 80 words.
- No emojis. No hype. Sound like a real person who gets it.

Output ONLY the message text. No preamble, no quotes, no commentary.`

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
}

const EXCERPT_CAP = 2000
const PHRASE_CAP = 8

/** Build the user-turn content for the opener call. Pure + deterministic. */
export function buildOpenerUserContent(opts: OpenerInput): string {
  const excerpt = (opts.excerpt ?? '').trim().slice(0, EXCERPT_CAP)
  const phrases = (opts.phrases ?? [])
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, PHRASE_CAP)

  return (
    `Subreddit: r/${opts.subreddit}\n` +
    `Author: u/${opts.author || 'unknown'}\n` +
    (opts.topic ? `Topic: ${opts.topic}\n` : '') +
    (opts.intentType ? `Intent signal: ${opts.intentType}\n` : '') +
    (opts.valueProp ? `\nWhat I'm building (context only — do NOT pitch it): ${opts.valueProp}\n` : '') +
    (phrases.length > 0
      ? `\nRecurring phrases real buyers use (mirror this language where natural): ${phrases.join('; ')}\n`
      : '') +
    (opts.guidance ? `\nWhat has converted before (lean into this angle): ${opts.guidance.trim()}\n` : '') +
    `\n--- Their post/comment ---\n${excerpt}\n--- end ---\n\n` +
    `Write the opening message. Lead with their problem, mirror their words, end with one soft question.`
  )
}

/** Strip wrapping quotes/backticks and surrounding whitespace from the model
 *  output; return null when nothing usable remains. */
export function cleanOpenerText(raw: string): string | null {
  const cleaned = raw.trim().replace(/^["'`]+|["'`]+$/g, '').trim()
  return cleaned.length > 0 ? cleaned : null
}
