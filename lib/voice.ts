// The founder's voice. Pure + framework-free (no 'server-only') so the prompt
// assembly and per-draft randomization stay unit-testable in plain vitest.
//
// Two jobs:
//   1. PERSONA_SYSTEM_PROMPT — the one voice both the Leads opener and the
//      Signals reply speak in. Shared so the rules live in exactly one place.
//   2. Per-draft shape (length + angle) + voice anchor, injected into the user
//      turn so every generation varies and reads like a real person, never a
//      template.

// The verbatim voice rules. Identical for the opener and the draft reply — both
// are "a real person replying on Reddit". The trailing output instruction keeps
// the model from wrapping the message in preamble/quotes.
export const PERSONA_SYSTEM_PROMPT = `You're a real person replying on Reddit — a peer, not a consultant, coach, or marketer.
Never restate or summarize their problem back. Assume they know it.
No canned openers: "I see…", "That's a tough spot", "I hear you", "Great question".
Banned words: leverage, streamline, pain point, solution, robust, seamless, journey, unpack, "in today's".
Serious and direct. One specific, opinionated, genuinely useful thing — the kind only someone who's done it would say. The value is the hook.
Plain, confident, properly written. No filler, no emoji, no forced casualness or lowercase quirk.
End with at most one sharp, specific question or a clean offer — sometimes none. Never pitch or name a product unless asked.

Output ONLY the message text. No preamble, no quotes, no commentary.`

// Higher temperature than the bulk classifiers: we want range, not consistency.
export const DRAFT_TEMPERATURE = 0.9

// ─── Per-draft shape ──────────────────────────────────────────────────────────
// Randomizing length + angle (but never register) is what stops every draft
// from collapsing into the same mirror-then-question template.

export type DraftLength = 'one-liner' | 'short' | 'medium' | 'long'
export type DraftAngle =
  | 'experience'
  | 'blunt-take'
  | 'answer-then-question'
  | 'concrete-tip'

export type DraftShape = { length: DraftLength; angle: DraftAngle }

const LENGTH_GUIDE: Record<DraftLength, string> = {
  'one-liner': 'one line — a single sharp sentence, nothing more',
  short: 'short — one or two sentences',
  medium: 'medium — two to four sentences',
  long: 'longer — a full short paragraph, earned only because their post has the detail to support it',
}

const ANGLE_GUIDE: Record<DraftAngle, string> = {
  experience: 'lead with a specific thing you did or watched work — first-hand and concrete',
  'blunt-take': 'open with a blunt, opinionated take on what actually matters here',
  'answer-then-question': 'answer the thing directly, then ask one sharp follow-up',
  'concrete-tip': 'give one concrete tip they can act on immediately',
}

// Weighted toward short/medium. 'long' is only in the pool when their post is
// detailed enough to earn it (see pickShape).
const LENGTH_WEIGHTS: ReadonlyArray<readonly [DraftLength, number]> = [
  ['one-liner', 1],
  ['short', 3],
  ['medium', 3],
  ['long', 2],
]

const ANGLES: readonly DraftAngle[] = [
  'experience',
  'blunt-take',
  'answer-then-question',
  'concrete-tip',
]

// A post is "detailed" once it's long enough that a full paragraph reply won't
// look like overcompensating for a one-line question.
const DETAILED_MIN_CHARS = 600

function weightedPick<T>(
  items: ReadonlyArray<readonly [T, number]>,
  rand: () => number,
): T {
  const total = items.reduce((sum, [, w]) => sum + w, 0)
  let r = rand() * total
  for (const [item, w] of items) {
    r -= w
    if (r < 0) return item
  }
  return items[items.length - 1][0]
}

/** Pick a fresh length + angle for one draft. `long` is offered only when the
 *  post is detailed. `rand` is injectable for deterministic tests. */
export function pickShape(excerpt: string, rand: () => number = Math.random): DraftShape {
  const detailed = (excerpt ?? '').trim().length >= DETAILED_MIN_CHARS
  const lengths = detailed ? LENGTH_WEIGHTS : LENGTH_WEIGHTS.filter(([l]) => l !== 'long')
  const length = weightedPick(lengths, rand)
  const angle = ANGLES[Math.floor(rand() * ANGLES.length)] ?? 'experience'
  return { length, angle }
}

/** The shape directive injected into the user turn. */
export function renderShapeDirective(shape: DraftShape): string {
  return (
    `Shape for this one (vary it — never a template):\n` +
    `- Length: ${LENGTH_GUIDE[shape.length]}.\n` +
    `- Angle: ${ANGLE_GUIDE[shape.angle]}.`
  )
}

// ─── Voice anchor ─────────────────────────────────────────────────────────────

const SAMPLE_CHAR_CAP = 800

/** Randomly take 1–2 of the founder's samples as this draft's style anchor.
 *  Shuffles so the same pair isn't reused every time. `rand` is injectable. */
export function selectVoiceSamples(
  samples: readonly string[] | null | undefined,
  rand: () => number = Math.random,
): string[] {
  const clean = (samples ?? []).map((s) => s.trim()).filter(Boolean)
  if (clean.length <= 1) return clean.slice(0, 1)
  const arr = [...clean]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  const count = rand() < 0.5 ? 1 : 2
  return arr.slice(0, Math.min(count, arr.length))
}

/** Render the style anchor for the already-selected samples. '' when there are
 *  none — the caller then falls back to the rules alone. */
export function renderVoiceAnchor(samples: readonly string[] | null | undefined): string {
  const picked = (samples ?? [])
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.slice(0, SAMPLE_CHAR_CAP))
  if (picked.length === 0) return ''
  const quoted = picked.map((s) => `"${s}"`).join('\n\n')
  return (
    `Write in this person's voice — serious, direct, no fluff. ` +
    `Match their rhythm, not their topics:\n\n${quoted}`
  )
}
