// QA — the layer that checks the workers.
//
// Everything upstream produces. Nothing until now has checked. Every quality
// failure in this project was found by a human looking at a log: an off-enum
// category, a vocabulary review that silently did nothing, an invented
// subreddit, a ranking that put two posts above eighteen.
//
// Two auditors:
//
//   AUDITOR  re-labels a random sample BLIND with a different model and reports
//            DISAGREEMENT. Blind matters: an auditor shown the original label
//            agrees with it. Disagreement is the only number here that can go
//            badly, which is why it is the one worth having.
//
//   SKEPTIC  takes a topic the scorer called wide open and tries to REFUTE it by
//            naming products that already solve it. If it can name real ones,
//            the whitespace score is wrong — the tools simply were not mentioned
//            in the posts we read. Told to default to "refuted" when unsure, so
//            it cannot rubber-stamp.
//
// Both are sampled, not exhaustive: QA that costs as much as the work it checks
// will not get run.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import Anthropic from '@anthropic-ai/sdk'
import {
  outDir, loadCorpus, loadEnv, coerceCategory, JUDGEMENT_MODEL,
  type Log, type Classified, type ScoredTopic,
} from './scan-core'
import { loadKnowledge, postKey } from './knowledge'
import { canonicalTopic } from '../lib/topics'

const file = () => new URL('audit.json', outDir())

export type AuditRun = {
  at: number
  sampled: number
  categoryAgree: number
  topicAgree: number
  toolAgree: number
  /** Cases where the two labels differ — the useful output. */
  disputes: Array<{ title: string; url: string; ours: string; theirs: string; kind: string }>
}

export type SkepticVerdict = {
  topic: string
  whitespace: number
  refuted: boolean
  existing: string[]
  why: string
  /** Even when refuted, the specific sub-segment, use-case or audience the
   *  named incumbents still fail to serve. This is the actionable residue. */
  residualGap: string
}

export type AuditStore = { runs: AuditRun[]; verdicts: SkepticVerdict[] }

export function loadAudit(): AuditStore {
  if (!existsSync(file())) return { runs: [], verdicts: [] }
  try {
    const a = JSON.parse(readFileSync(file(), 'utf8')) as AuditStore
    return { runs: a.runs ?? [], verdicts: a.verdicts ?? [] }
  } catch {
    return { runs: [], verdicts: [] }
  }
}

function saveAudit(a: AuditStore): void {
  a.runs = a.runs.slice(-50)
  a.verdicts = a.verdicts.slice(-200)
  writeFileSync(file(), JSON.stringify(a, null, 2))
}

function client(): Anthropic {
  loadEnv()
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('ANTHROPIC_API_KEY missing')
  return new Anthropic({ apiKey: key })
}

/** Refuted verdicts as a topic -> incumbent-products map, for the scorer. */
export function loadRefutedTools(): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const v of loadAudit().verdicts) {
    if (!v.refuted || !v.existing.length) continue
    out[v.topic] = Array.from(new Set([...(out[v.topic] ?? []), ...v.existing]))
  }
  return out
}

/** Residual gaps the Skeptic left behind when it refuted a topic, by topic. */
export function loadRefutedGaps(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const v of loadAudit().verdicts) {
    if (v.residualGap) out[v.topic] = v.residualGap
  }
  return out
}

// --- auditor ----------------------------------------------------------------

const AUDIT_TOOL: Anthropic.Messages.Tool = {
  name: 'label_posts',
  description: 'Independently label each numbered post.',
  input_schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            i: { type: 'number' },
            category: { type: 'string', enum: ['pain_point', 'feature_request', 'tool_complaint', 'other'] },
            topic: { type: 'string', description: 'A GENERAL 2-3 word lowercase topic' },
            tools: { type: 'array', items: { type: 'string' }, description: 'Named existing products only' },
          },
          required: ['i', 'category', 'topic', 'tools'],
        },
      },
    },
    required: ['items'],
  },
}

const AUDIT_SYSTEM =
  'You are independently labelling forum posts for a demand study. You have NOT seen any ' +
  'previous labels and must not guess at them — judge only what the post says.\n\n' +
  '"other" is the correct answer for news, showoff posts, job ads and general discussion. ' +
  'Only mark pain_point or feature_request when someone describes a real unmet need. ' +
  'In `tools`, list only NAMED existing products, never generic nouns. ' +
  'For `topic`, use the most general 2-3 word phrasing that still fits.'

/** Deterministic sample so a run is reproducible and cannot be cherry-picked. */
function sampleEvenly<T>(items: T[], n: number): T[] {
  if (items.length <= n) return items
  const step = items.length / n
  return Array.from({ length: n }, (_, i) => items[Math.floor(i * step)])
}

export async function auditClassifications(log: Log, sampleSize = 24): Promise<AuditRun> {
  const k = loadKnowledge()
  const corpus = loadCorpus()
  const labelled = corpus.filter((e) => k.posts[postKey(e.source, e.externalId)])
  if (labelled.length < 8) throw new Error('Not enough classified posts to audit yet.')

  const sample = sampleEvenly(labelled, sampleSize)
  log(`re-labelling ${sample.length} of ${labelled.length} posts blind, on ${JUDGEMENT_MODEL}`)

  const list = sample
    .map((p, n) => `${n}. ${p.title}\n${(p.body || '').slice(0, 320)}`)
    .join('\n\n')

  const res = await client().messages.create({
    model: JUDGEMENT_MODEL,
    max_tokens: 2500,
    system: AUDIT_SYSTEM,
    tools: [AUDIT_TOOL],
    tool_choice: { type: 'tool', name: 'label_posts' },
    messages: [{ role: 'user', content: `Label these ${sample.length} posts:\n\n${list}` }],
  })

  const blk = res.content.find((c) => c.type === 'tool_use')
  const items: Array<{ i: number; category: string; topic: string; tools: string[] }> =
    blk?.type === 'tool_use' ? ((blk.input as { items?: never[] }).items ?? []) : []

  let catOk = 0
  let topicOk = 0
  let toolOk = 0
  let n = 0
  const disputes: AuditRun['disputes'] = []

  for (const it of items) {
    const post = sample[it.i]
    if (!post) continue
    const ours: Classified | undefined = k.posts[postKey(post.source, post.externalId)]
    if (!ours) continue
    n++

    const theirCat = coerceCategory(it.category)
    if (theirCat === ours.category) catOk++
    else {
      disputes.push({
        title: post.title.slice(0, 100), url: post.url,
        ours: ours.category, theirs: theirCat, kind: 'category',
      })
    }

    const theirTopic = canonicalTopic(it.topic) ?? ''
    if (theirTopic && theirTopic === ours.topic) topicOk++

    // Tool extraction is the input the whitespace model is most sensitive to,
    // so agreement is measured on whether ANY tool was found, not exact names.
    const oursHas = (ours.tools?.length ?? 0) > 0
    const theirsHas = (it.tools?.length ?? 0) > 0
    if (oursHas === theirsHas) toolOk++
    else {
      disputes.push({
        title: post.title.slice(0, 100), url: post.url,
        ours: oursHas ? ours.tools.join(', ') : 'no tools',
        theirs: theirsHas ? it.tools.join(', ') : 'no tools',
        kind: 'tools',
      })
    }
  }

  const run: AuditRun = {
    at: Date.now(),
    sampled: n,
    categoryAgree: n ? catOk / n : 0,
    topicAgree: n ? topicOk / n : 0,
    toolAgree: n ? toolOk / n : 0,
    disputes: disputes.slice(0, 30),
  }

  const store = loadAudit()
  store.runs.push(run)
  saveAudit(store)

  log(`category agreement ${Math.round(run.categoryAgree * 100)}%`)
  log(`topic agreement ${Math.round(run.topicAgree * 100)}% (exact string — low is expected)`)
  log(`tool-presence agreement ${Math.round(run.toolAgree * 100)}%`)
  log(`${disputes.length} disputes recorded`)
  return run
}

// --- skeptic ----------------------------------------------------------------

const SKEPTIC_TOOL: Anthropic.Messages.Tool = {
  name: 'refute',
  description: 'Try to refute the claim that a need is unmet.',
  input_schema: {
    type: 'object',
    properties: {
      refuted: { type: 'boolean', description: 'True if products already solve this well' },
      existing: {
        type: 'array', items: { type: 'string' },
        description: 'Real, shipping products that solve it. Empty if you cannot name any.',
      },
      why: { type: 'string', description: 'One line' },
      residualGap: {
        type: 'string',
        description:
          'The specific sub-segment, use-case or audience these products still fail to serve well. Be concrete — name who, not a vague platitude. Empty string if genuinely none.',
      },
    },
    required: ['refuted', 'existing', 'why', 'residualGap'],
  },
}

const SKEPTIC_SYSTEM =
  'A demand study claims the following need is largely unmet, based only on forum posts where ' +
  'nobody named a tool. Your job is to REFUTE that: name real, shipping products that already ' +
  'solve it well.\n\n' +
  'Only name products you are confident exist — an invented product is worse than none. ' +
  'If several established products cover it, set refuted = true.\n' +
  'Default to refuted = true when you are unsure: a score that survives a genuine attempt to ' +
  'knock it down is worth something, and one that survives only because the checker was polite is not.\n\n' +
  'Refuting is NOT the whole answer. The incumbent products you name are usually built for ' +
  'enterprises or a general audience; the demand came from a specific niche. In residualGap, ' +
  'state what that niche still cannot get: which sub-segment, price tier, or use-case the named ' +
  'incumbents leave unserved. Be concrete (name the audience). Only leave it empty if the space ' +
  'is served at every level.'

export async function challengeTopics(
  topics: ScoredTopic[],
  log: Log,
  max = 20,
): Promise<SkepticVerdict[]> {
  // Challenge every scoreable topic, but only once the NEW schema has seen it:
  // a verdict with a residualGap field is final. Verdicts from before the
  // residual-gap feature have no such field, so they get backfilled.
  const existing = loadAudit()
  const already = new Set(
    existing.verdicts.filter((v) => typeof v.residualGap === 'string').map((v) => v.topic),
  )
  const targets = topics.filter((t) => !already.has(t.topic)).slice(0, max)
  if (!targets.length) {
    log('all scoreable topics already challenged — nothing new to check')
    return []
  }
  log(
    `challenging ${targets.length} topic${targets.length === 1 ? '' : 's'} ` +
      `(${already.size} already checked)`,
  )
  const anthropic = client()
  const out: SkepticVerdict[] = []

  for (const t of targets) {
    const evidence = t.examples.map((e) => `- ${e.title}`).join('\n')
    const res = await anthropic.messages.create({
      model: JUDGEMENT_MODEL,
      max_tokens: 700,
      system: SKEPTIC_SYSTEM,
      tools: [SKEPTIC_TOOL],
      tool_choice: { type: 'tool', name: 'refute' },
      messages: [{
        role: 'user',
        content: `Claimed unmet need: "${t.topic}"\nPosts behind it:\n${evidence}`,
      }],
    })
    const blk = res.content.find((c) => c.type === 'tool_use')
    const v = blk?.type === 'tool_use' ? (blk.input as { refuted?: boolean; existing?: string[]; why?: string; residualGap?: string }) : {}
    // Strip model function-call artifacts ("</residualGap>", "</invoke>") that
    // occasionally leak into the text — they are noise, not data.
    const clean = (s: string) => s.replace(/<\/?[a-z_]+>/gi, '').trim()
    const verdict: SkepticVerdict = {
      topic: t.topic,
      whitespace: t.whitespace,
      refuted: !!v.refuted,
      existing: (Array.isArray(v.existing) ? v.existing : []).slice(0, 8).map(clean),
      why: clean(String(v.why ?? '')),
      residualGap: clean(String(v.residualGap ?? '')),
    }
    out.push(verdict)
    log(
      verdict.refuted
        ? `REFUTED  ${t.topic} — ${verdict.existing.join(', ') || 'already solved'}` +
          (verdict.residualGap ? ` · still open: ${verdict.residualGap}` : '')
        : `stands   ${t.topic}`,
    )
  }

  const store = loadAudit()
  store.verdicts.push(...out)
  saveAudit(store)
  return out
}
