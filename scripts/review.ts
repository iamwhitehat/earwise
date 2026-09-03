// Vocabulary review — the pass that makes run 100 better than run 1.
//
// Canonicalization (lib/topics.ts) is deterministic string rules: it collapses
// "authentication issues" into "auth problem", but it cannot know that
// "study method", "exam preparation" and "exam resource" are one thing while
// "clinical diagnosis" and "clinical workflow efficiency" are not. That needs
// judgement about meaning.
//
// So: one cheap model call reviews the accumulated vocabulary and proposes
// merges. The result is stored as an ALIAS MAP, not applied once — every
// future classification resolves through it, so a merge decided here keeps
// paying off without ever being re-decided.
//
// Guards, because a bad merge silently corrupts every count downstream:
//   - only topics with real evidence are offered for review
//   - the canonical name must be one of the inputs, never invented
//   - a merge that would swallow more than MAX_MERGE_SHARE of the vocabulary
//     is rejected outright — that is the collapse failure, not a merge
//   - every merge is recorded in knowledge.merges with what it absorbed

import Anthropic from '@anthropic-ai/sdk'
import { model, type Log } from './scan-core'
import {
  loadKnowledge, saveKnowledge, mergeTopics, concentration, type Knowledge,
} from './knowledge'

/** Never let one merge absorb more than this share of all labelled posts. */
const MAX_MERGE_SHARE = 0.35
/** Reviewing a handful of topics is noise; wait until there is a vocabulary. */
const MIN_TOPICS = 8

const MERGE_TOOL: Anthropic.Messages.Tool = {
  name: 'propose_merges',
  description: 'Propose groups of topic labels that mean the same thing.',
  input_schema: {
    type: 'object',
    properties: {
      merges: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            canonical: {
              type: 'string',
              description: 'The clearest label of the group. MUST be copied exactly from the input list.',
            },
            aliases: {
              type: 'array',
              items: { type: 'string' },
              description: 'Other labels from the input list that mean the same thing. Exact strings.',
            },
            reason: { type: 'string', description: 'One short line on why these are the same' },
          },
          required: ['canonical', 'aliases', 'reason'],
        },
      },
    },
    required: ['merges'],
  },
}

const SYSTEM =
  'You are consolidating a topic vocabulary built from developer/professional forum posts. ' +
  'Group ONLY labels that describe the same underlying need, so their post counts can be added ' +
  'together honestly.\n\n' +
  'Merge: wording variants, singular/plural, and narrower phrasings of one need.\n' +
  'Do NOT merge: two genuinely different needs that share a domain word. "clinical diagnosis" ' +
  'and "clinical workflow efficiency" are different problems despite both being clinical. ' +
  'Merging them would invent demand that nobody expressed.\n\n' +
  'Returning an empty list is the correct answer when the vocabulary is already clean. ' +
  'Over-merging is far more damaging than under-merging: it silently inflates a topic into ' +
  'looking like validated demand.'

export type ReviewResult = {
  reviewed: number
  proposed: number
  applied: number
  rejected: Array<{ canonical: string; why: string }>
  postsMoved: number
  before: { topics: number; effectiveTopics: number }
  after: { topics: number; effectiveTopics: number }
}

export async function reviewVocabulary(log: Log, k?: Knowledge): Promise<ReviewResult> {
  const kn = k ?? loadKnowledge()
  const before = { topics: Object.keys(kn.topics).length, ...concentration(kn) }

  const entries = Object.entries(kn.topics).sort((a, b) => b[1].count - a[1].count)
  const empty: ReviewResult = {
    reviewed: entries.length,
    proposed: 0,
    applied: 0,
    rejected: [],
    postsMoved: 0,
    before: { topics: before.topics, effectiveTopics: before.effectiveTopics },
    after: { topics: before.topics, effectiveTopics: before.effectiveTopics },
  }
  if (entries.length < MIN_TOPICS) {
    log(`only ${entries.length} topics — too few to review`)
    return empty
  }

  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('ANTHROPIC_API_KEY missing')
  const anthropic = new Anthropic({ apiKey: key })

  const list = entries.map(([n, t]) => `- ${n} (${t.count})`).join('\n')
  const res = await anthropic.messages.create({
    model: model(),
    max_tokens: 1500,
    system: SYSTEM,
    tools: [MERGE_TOOL],
    tool_choice: { type: 'tool', name: 'propose_merges' },
    messages: [{ role: 'user', content: `Topic vocabulary — "label (post count)":\n${list}` }],
  })

  const block = res.content.find((c) => c.type === 'tool_use')
  const proposals =
    block?.type === 'tool_use'
      ? ((block.input as { merges?: Array<{ canonical: string; aliases: string[]; reason: string }> })
          .merges ?? [])
      : []

  const known = new Set(entries.map(([n]) => n))
  const totalPosts = entries.reduce((a, [, t]) => a + t.count, 0)
  const rejected: ReviewResult['rejected'] = []
  let applied = 0
  let postsMoved = 0
  const now = Date.now()

  for (const p of proposals) {
    const canonical = String(p?.canonical ?? '')
    const aliases = (Array.isArray(p?.aliases) ? p.aliases : []).map(String)

    // The canonical name must be a label we actually have, or the merge points
    // at a topic with no evidence behind it.
    if (!known.has(canonical)) {
      rejected.push({ canonical, why: 'canonical not in vocabulary' })
      continue
    }
    const real = aliases.filter((a) => known.has(a) && a !== canonical)
    if (!real.length) {
      rejected.push({ canonical, why: 'no known aliases' })
      continue
    }

    const merged =
      (kn.topics[canonical]?.count ?? 0) + real.reduce((a, x) => a + (kn.topics[x]?.count ?? 0), 0)
    if (totalPosts > 0 && merged / totalPosts > MAX_MERGE_SHARE) {
      rejected.push({
        canonical,
        why: `would hold ${Math.round((merged / totalPosts) * 100)}% of all posts — collapse, not a merge`,
      })
      continue
    }

    const moved = mergeTopics(kn, canonical, real, now)
    if (moved) {
      applied++
      postsMoved += moved
      log(`merged ${real.length} into "${canonical}" (${moved} posts) — ${p.reason ?? ''}`)
    }
  }

  for (const r of rejected) log(`rejected merge "${r.canonical}": ${r.why}`)
  if (applied) saveKnowledge(kn)

  const after = { topics: Object.keys(kn.topics).length, ...concentration(kn) }
  log(
    `vocabulary ${before.topics} → ${after.topics} topics · effective ` +
      `${before.effectiveTopics.toFixed(1)} → ${after.effectiveTopics.toFixed(1)}`,
  )

  return {
    reviewed: entries.length,
    proposed: proposals.length,
    applied,
    rejected,
    postsMoved,
    before: { topics: before.topics, effectiveTopics: before.effectiveTopics },
    after: { topics: after.topics, effectiveTopics: after.effectiveTopics },
  }
}
