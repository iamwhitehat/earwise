// Pure prompt-assembly + normalization for the Voice engine. Distills
// Voice-of-Customer data + the founder's profile into one crisp, founder-grade
// output: a positioning line, 3-5 resonant angles (each anchored to the buyers'
// exact words), and a few copy-paste snippets. No 'server-only' so it stays
// unit-testable — mirrors lib/opener.ts. The Claude call lives in lib/claude.ts.

export type VoiceAngle = {
  angle: string
  /** Why this framing lands with these buyers. */
  whyItLands: string
  /** Verbatim phrases from the buyers' own language to use in this angle. */
  exactWords: string[]
}

export type VoiceSnippet = {
  /** e.g. "one-liner", "elevator", "cold opener", "landing subhead". */
  label: string
  text: string
  /** Verbatim source quotes the snippet draws from. */
  sources: string[]
}

export type VoiceBrief = {
  positioningLine: string
  angles: VoiceAngle[]
  snippets: VoiceSnippet[]
}

const clampStr = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.trim().slice(0, max) : ''

const cleanStrings = (v: unknown, cap: number): string[] =>
  (Array.isArray(v) ? v : [])
    .filter((s): s is string => typeof s === 'string')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, cap)

const MAX_ANGLES = 5
const MAX_SNIPPETS = 6

/** Build the user-turn content for the Voice synthesis. Pure + deterministic.
 *  Memory digest (if any) is prepended by the caller, like synthesizeMessaging. */
export function buildVoiceInput(opts: { vocText: string; profileText: string }): string {
  const profile = opts.profileText.trim() || '(no profile provided)'
  return (
    `# THE FOUNDER\n${profile}\n\n` +
    `# HOW THEIR BUYERS ACTUALLY TALK\n${opts.vocText.trim()}\n\n` +
    `Distill this into the founder's positioning, the angles that land, and copy they can ` +
    `paste — all in the buyers' own words. Reuse the verbatim quotes; never invent language.`
  )
}

/** Defensive clamp of the model's tool output. Returns null when nothing usable
 *  (no positioning line and no angles). Mirrors normalizeInsightsV2/normalizeMessaging. */
export function normalizeVoiceBrief(raw: unknown): VoiceBrief | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>

  const angles = (Array.isArray(o.angles) ? o.angles : [])
    .filter((a): a is Record<string, unknown> => typeof a === 'object' && a !== null)
    .map((a) => ({
      angle: clampStr(a.angle, 140),
      whyItLands: clampStr(a.whyItLands, 280),
      exactWords: cleanStrings(a.exactWords, 4),
    }))
    .filter((a) => a.angle.length > 0)
    .slice(0, MAX_ANGLES)

  const snippets = (Array.isArray(o.snippets) ? o.snippets : [])
    .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
    .map((s) => ({
      label: clampStr(s.label, 60),
      text: clampStr(s.text, 600),
      sources: cleanStrings(s.sources, 4),
    }))
    .filter((s) => s.text.length > 0)
    .slice(0, MAX_SNIPPETS)

  const positioningLine = clampStr(o.positioningLine, 400)
  if (!positioningLine && angles.length === 0) return null

  return { positioningLine, angles, snippets }
}

const ANGLE_ANCHOR_CAP = 3

/** A short grounding block for the reply/opener generators so a draft leads with
 *  an angle consistent with the founder's positioning — WITHOUT pitching. Only
 *  the positioning line + top angle titles (never the marketing snippets, which
 *  would push toward promotion). '' when there's nothing usable. Pure. */
export function renderVoiceBriefAnchor(brief: VoiceBrief | null | undefined): string {
  if (!brief) return ''
  const pos = (brief.positioningLine ?? '').trim()
  const angles = (brief.angles ?? [])
    .map((a) => (a.angle ?? '').trim())
    .filter(Boolean)
    .slice(0, ANGLE_ANCHOR_CAP)
  if (!pos && angles.length === 0) return ''
  const lines = [
    'How you see this space — lead with a take that fits it. Do NOT pitch, name, or hint at a product:',
  ]
  if (pos) lines.push(`Your angle: ${pos}`)
  if (angles.length > 0) lines.push(`Framings you stand behind: ${angles.join('; ')}`)
  return lines.join('\n')
}
