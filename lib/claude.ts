import 'server-only'

import Anthropic from '@anthropic-ai/sdk'
import { createRateLimiter, PRIORITY, type Priority } from './rate-limiter'
import { type Category } from './categories'
import {
  parseClassification,
  normalizeTopic,
  normalizeClassifyExtractBatch,
  normalizeTopicsBatch,
  type Confidence,
  type Classification,
  type ClassifiedTopic,
} from './classify-parse'
import {
  OPENER_SYSTEM_PROMPT,
  buildOpenerUserContent,
  cleanOpenerText,
  type OpenerInput,
} from './opener'
import {
  PERSONA_SYSTEM_PROMPT,
  PERSONA_SYSTEM_PROMPT_SHORT,
  DRAFT_TEMPERATURE,
  pickShape,
  selectVoiceSamples,
  renderShapeDirective,
  renderVoiceAnchor,
  type DraftShape,
} from './voice'
import {
  buildVoiceInput,
  normalizeVoiceBrief,
  renderVoiceBriefAnchor,
  type VoiceBrief,
} from './voice-brief'
import type {
  InsightV2,
  InsightEvidence,
  MessagingAssets,
  MessagingAsset,
} from './insight-types'
import type { StrategyBrief } from './strategy'
import {
  BUYER_INTENT_SYSTEM_PROMPT,
  buildBuyerIntentInput,
  normalizeBuyerVerdicts,
  type BuyerIntentResult,
} from './buyer-intent'
import {
  RELEVANCE_SYSTEM_PROMPT,
  buildRelevanceInput,
  normalizeRelevanceVerdicts,
} from './relevance'

export type { Category }
export type { InsightV2, MessagingAssets }
// Re-exported so API routes can tag their Claude work without importing the
// rate-limiter directly (load-more = FOREGROUND, bulk deep-scan / cron = BULK).
export { PRIORITY, type Priority }

const VALID: ReadonlySet<Category> = new Set([
  'pain_point',
  'feature_request',
  'tool_complaint',
  'other',
])

// ─── Model tiers ──────────────────────────────────────────────────────────────
// Bulk work (classification, topic extraction, comment extraction, drafts) is
// always the cheapest Haiku — high volume, cached, cost-sensitive.
export const MODEL_BULK = 'claude-haiku-4-5-20251001'

// Synthesis (Insights, Buyer Language) is user-selectable via a Fast/Balanced/
// Max dropdown. Default is Fast (Haiku) to keep this cheap for private/solo use
// — bump to Balanced (Sonnet) or Max (Opus) per-run when a polished synthesis is
// actually worth the spend.
export type SynthTier = 'fast' | 'balanced' | 'max'
export const SYNTH_MODELS: Record<SynthTier, string> = {
  fast: MODEL_BULK,
  balanced: 'claude-sonnet-4-6',
  max: 'claude-opus-4-6',
}
export const DEFAULT_SYNTH_TIER: SynthTier = 'fast'

/** Resolve a (possibly untrusted) tier string to a concrete model id. */
export function resolveSynthModel(tier: unknown): string {
  return typeof tier === 'string' && tier in SYNTH_MODELS
    ? SYNTH_MODELS[tier as SynthTier]
    : SYNTH_MODELS[DEFAULT_SYNTH_TIER]
}

let _client: Anthropic | null = null

function getClient(): Anthropic {
  if (_client) return _client
  const key = process.env.ANTHROPIC_API_KEY
  if (!key || key.includes('REPLACE_WITH_YOUR')) {
    throw new Error(
      'Anthropic is not configured. Set ANTHROPIC_API_KEY in .env.local. See SETUP.md.'
    )
  }
  _client = new Anthropic({ apiKey: key })
  return _client
}

// ─── Global throttle ──────────────────────────────────────────────────────────
// Every Claude call goes through one process-wide rate limiter so we stay under
// the account's requests/min limit. It is PRIORITY-AWARE: a user-initiated
// FOREGROUND call (e.g. "Load more") jumps ahead of background BULK work (a
// 100-post deep-scan, cron ingest) instead of queueing behind all of it.
// Bounded concurrency lets a foreground call overlap a slow in-flight call
// (e.g. a 30s Opus synthesis) rather than waiting it out. See lib/rate-limiter.ts.
//
// On 429: back the whole dispatcher off for 60s, then retry (up to twice) in the
// same slot — so concurrent waiters back off too (they would also 429).

// The 1.5s default keeps starts ~40 req/min, safely under the 50 req/min tier.
// Override with CLAUDE_MIN_GAP_MS for higher-tier accounts (e.g. 600 ≈ 100/min)
// — lower = faster scans, but too low for your rate limit means 429 backoffs.
// Clamped to [0, 10000]; a non-numeric/empty value falls back to the default.
function resolveMinGapMs(): number {
  const raw = process.env.CLAUDE_MIN_GAP_MS
  if (raw === undefined || raw.trim() === '') return 1500
  const n = Number(raw)
  if (!Number.isFinite(n)) return 1500
  return Math.min(10_000, Math.max(0, Math.round(n)))
}

// Max Claude calls in flight at once. >1 lets a foreground call overlap a slow
// in-flight one; it does NOT raise the start rate (still ≤ 1 start / MIN_GAP_MS).
// Override with CLAUDE_MAX_CONCURRENCY; clamped to [1, 8], default 2.
function resolveMaxConcurrency(): number {
  const raw = process.env.CLAUDE_MAX_CONCURRENCY
  if (raw === undefined || raw.trim() === '') return 2
  const n = Number(raw)
  if (!Number.isFinite(n)) return 2
  return Math.min(8, Math.max(1, Math.round(n)))
}

const MIN_GAP_MS = resolveMinGapMs()
const MAX_CONCURRENCY = resolveMaxConcurrency()
const RETRY_DELAY_MS = 60_000
const MAX_RETRIES = 2

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

const limiter = createRateLimiter({ minGapMs: MIN_GAP_MS, maxConcurrency: MAX_CONCURRENCY })

function isRateLimit(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { status?: number }).status === 429
}

async function callClaude<T>(make: () => Promise<T>, priority: number = PRIORITY.NORMAL): Promise<T> {
  return limiter.schedule(priority, async () => {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await make()
      } catch (err) {
        if (!isRateLimit(err) || attempt === MAX_RETRIES) throw err
        limiter.pauseFor(RETRY_DELAY_MS) // back off the whole dispatcher
        console.warn(
          `[claude] 429 received, retrying in ${RETRY_DELAY_MS / 1000}s ` +
          `(attempt ${attempt + 1}/${MAX_RETRIES})`
        )
        await sleep(RETRY_DELAY_MS)
      }
    }
    throw new Error('unreachable')
  })
}

// ─── Structured (tool-use) output ─────────────────────────────────────────────
// Forces schema-valid JSON by giving the model a single tool and requiring it
// via tool_choice. The model can't return free text, so there's no brittle
// regex JSON extraction — the tool input IS the parsed object. Callers still
// run their defensive normalizer on the result (clamping lengths/enums).
type StructuredTool = Anthropic.Messages.Tool

export async function callStructured<T = unknown>(
  model: string,
  system: string,
  user: string,
  tool: StructuredTool,
  maxTokens = 2000,
  priority: number = PRIORITY.NORMAL,
): Promise<T | null> {
  try {
    const msg = await callClaude(() =>
      getClient().messages.create({
        model,
        max_tokens: maxTokens,
        system,
        tools: [tool],
        tool_choice: { type: 'tool', name: tool.name },
        messages: [{ role: 'user', content: user }],
      }),
      priority,
    )
    // When the model hits the token ceiling mid tool-call, the API returns a
    // truncated tool_use whose `input` is an empty/partial object — the caller's
    // normalizer then yields nothing and the user sees a confusing "returned no
    // results". Surface it loudly so it's diagnosable, and so callers can raise
    // max_tokens rather than chase a phantom prompt bug.
    if (msg.stop_reason === 'max_tokens') {
      console.warn(
        `[claude] callStructured(${tool.name}) hit max_tokens (${maxTokens}); ` +
        `tool output was truncated — raise max_tokens for this call.`
      )
    }
    for (const block of msg.content) {
      if (block.type === 'tool_use' && block.name === tool.name) {
        return block.input as T
      }
    }
    return null
  } catch (err) {
    console.error(`[claude] callStructured(${tool.name}) error:`, err)
    return null
  }
}

export type { Confidence, Classification }

export type ClassificationExample = {
  title: string
  snippet: string // first ~100 chars of body, may be empty for link posts
}

export type ExampleSet = Record<Category, ClassificationExample[]>

const VALID_CONFIDENCE: ReadonlySet<Confidence> = new Set(['high', 'medium', 'low'])

const SYSTEM_PROMPT_BASE = `You classify Reddit posts into exactly one of four categories:

- pain_point: the author is experiencing a problem, frustration, or struggle
- feature_request: the author wants a new feature, capability, or improvement
- tool_complaint: the author is complaining about a specific tool, library, framework, or service
- other: announcements, questions, tutorials, showcases, discussions — anything that does not fit the above`

const RESPONSE_INSTRUCTIONS = `Now classify the new post in the user message. Reply with ONLY a single JSON object in this exact shape — no markdown, no preamble, no explanation:

{"category":"pain_point|feature_request|tool_complaint|other","confidence":"high|medium|low"}

confidence reflects how clear the signal is — "high" when the post unambiguously fits the category, "medium" when it leans that way, "low" when it's borderline or ambiguous.`

function renderExamples(examples: ExampleSet): string {
  const labels: Record<Category, string> = {
    pain_point: 'PAIN_POINT',
    feature_request: 'FEATURE_REQUEST',
    tool_complaint: 'TOOL_COMPLAINT',
    other: 'OTHER',
  }
  const blocks: string[] = []
  for (const cat of ['pain_point', 'feature_request', 'tool_complaint', 'other'] as Category[]) {
    const list = examples[cat] ?? []
    if (list.length === 0) continue
    const lines = list.map((ex) => {
      const t = ex.title.slice(0, 160).replace(/\s+/g, ' ').trim()
      const s = ex.snippet.slice(0, 100).replace(/\s+/g, ' ').trim()
      return s ? `- "${t}" — ${s}` : `- "${t}"`
    })
    blocks.push(`${labels[cat]}:\n${lines.join('\n')}`)
  }
  if (blocks.length === 0) return ''
  return `\n\nReference examples from previously-classified posts:\n\n${blocks.join('\n\n')}`
}

export async function classifyPost(
  title: string,
  selftext: string,
  examples?: ExampleSet,
): Promise<Classification> {
  const body = selftext.trim().slice(0, 800)
  const content = body ? `Title: ${title}\n\nBody: ${body}` : `Title: ${title}`
  const system = SYSTEM_PROMPT_BASE + (examples ? renderExamples(examples) : '') + '\n\n' + RESPONSE_INSTRUCTIONS

  try {
    const msg = await callClaude(() =>
      getClient().messages.create({
        model: MODEL_BULK,
        max_tokens: 60,
        system,
        messages: [{ role: 'user', content }],
      })
    )

    const block = msg.content[0]
    if (!block || block.type !== 'text') return { category: 'other', confidence: 'medium' }
    return parseClassification(block.text)
  } catch (err) {
    console.error('[claude] classifyPost error:', err)
    return { category: 'other', confidence: 'medium' }
  }
}

const TOPIC_SYSTEM_PROMPT = `You extract a short topic label from a Reddit post about software, tools, or business.

Rules:
- Output 2 to 4 lowercase words separated by single spaces
- No punctuation, no quotes, no explanation
- Examples of good labels: "onboarding friction", "pricing confusion", "auth problems", "cold email deliverability", "stripe integration", "ai hallucinations", "lead generation"
- The label should describe a concept that other similar posts would also match — not a specific named entity or one-off detail

If a label from the "Known topics" list (provided in the user message) fits, reuse it exactly. Otherwise coin a new short label that follows the same shape.

Reply with only the topic label.`

export async function extractTopic(
  title: string,
  selftext: string,
  knownTopics: string[],
): Promise<string | null> {
  const body = selftext.trim().slice(0, 800)
  const postContent = body ? `Title: ${title}\n\nBody: ${body}` : `Title: ${title}`

  const knownSection =
    knownTopics.length > 0
      ? `Known topics (reuse one of these if it fits):\n${knownTopics.map((t) => `- ${t}`).join('\n')}\n\n`
      : ''
  const userContent = `${knownSection}${postContent}`

  try {
    const msg = await callClaude(() =>
      getClient().messages.create({
        model: MODEL_BULK,
        max_tokens: 30,
        system: TOPIC_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }],
      })
    )
    const block = msg.content[0]
    if (!block || block.type !== 'text') return null
    return normalizeTopic(block.text)
  } catch (err) {
    console.error('[claude] extractTopic error:', err)
    return null
  }
}

// ─── Batched classify + topic ─────────────────────────────────────────────────
// Classify MANY posts in ONE Claude call. The throttle serializes every call
// with a fixed gap, so collapsing N posts into ceil(N/BATCH) calls is the real
// scan speedup (e.g. 60 posts: 60 calls → 8). The model returns one entry per
// post tagged with its 1-based index; normalizeClassifyExtractBatch re-aligns
// by index so a scrambled/partial response never lands a result on the wrong
// post. Per-batch failure degrades to all-defaults for that batch, never throws.
export const CLASSIFY_BATCH_SIZE = 8

const CLASSIFY_BATCH_TOOL: StructuredTool = {
  name: 'classify_posts',
  description: 'Classify every numbered post and extract its topic; return exactly one entry per post.',
  input_schema: {
    type: 'object',
    properties: {
      classifications: {
        type: 'array',
        description: 'One entry per numbered post. Order does not matter; the index field maps each entry to its post.',
        items: {
          type: 'object',
          properties: {
            index: { type: 'integer', description: 'The post number from its [n] marker (1-based).' },
            category: { type: 'string', enum: ['pain_point', 'feature_request', 'tool_complaint', 'other'] },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            topic: {
              type: 'string',
              description: '2–4 lowercase words naming the post\'s concept; empty string when category is "other" or there is no clear topic.',
            },
          },
          required: ['index', 'category', 'confidence', 'topic'],
        },
      },
    },
    required: ['classifications'],
  },
}

const CLASSIFY_BATCH_SYSTEM = `${SYSTEM_PROMPT_BASE}

You classify MULTIPLE posts in one pass. For EACH numbered post, assign a category, a confidence, and a short topic label.

Topic label rules:
- 2 to 4 lowercase words, no punctuation
- Describe a concept that other similar posts would also match — not a specific named entity or one-off detail
- If a label from the "Known topics" list in the user message fits, reuse it exactly; otherwise coin a new short label in the same shape
- Use an empty string for the topic when the category is "other" or there's no clear topic

Call the classify_posts tool with one entry per post: its index (matching the [n] marker), category, confidence, and topic. Return an entry for EVERY post — do not skip any.`

function renderKnownTopics(knownTopics: string[]): string {
  return knownTopics.length > 0
    ? `Known topics (reuse one exactly if it fits):\n${knownTopics.map((t) => `- ${t}`).join('\n')}\n\n`
    : ''
}

function renderNumberedPosts(posts: Array<{ title: string; selftext: string }>): string {
  return posts
    .map((p, i) => {
      const body = p.selftext.trim().slice(0, 800)
      return body ? `[${i + 1}]\nTitle: ${p.title}\n\nBody: ${body}` : `[${i + 1}]\nTitle: ${p.title}`
    })
    .join('\n\n')
}

export async function classifyAndExtractBatch(
  posts: Array<{ title: string; selftext: string }>,
  opts: { examples?: ExampleSet; knownTopics?: string[]; priority?: number } = {},
): Promise<ClassifiedTopic[]> {
  if (posts.length === 0) return []
  const user =
    `${renderKnownTopics(opts.knownTopics ?? [])}Classify each of the ${posts.length} numbered posts below. ` +
    `Return exactly one entry per post, matching its [n] number.\n\nPosts:\n\n${renderNumberedPosts(posts)}`
  const system = CLASSIFY_BATCH_SYSTEM + (opts.examples ? renderExamples(opts.examples) : '')
  const maxTokens = Math.min(4096, 300 + posts.length * 90)
  const result = await callStructured(
    MODEL_BULK, system, user, CLASSIFY_BATCH_TOOL, maxTokens, opts.priority ?? PRIORITY.NORMAL,
  )
  return normalizeClassifyExtractBatch(result, posts.length)
}

// ─── Batched topic-only extraction ────────────────────────────────────────────
// For backfilling topics onto posts whose category is already known. Unlike the
// classify batch, this never re-categorizes, so a post keeps its stored category
// and just gains a topic. One call per BATCH posts.
const EXTRACT_TOPICS_TOOL: StructuredTool = {
  name: 'extract_topics',
  description: 'Extract a short topic label for every numbered post; return one entry per post.',
  input_schema: {
    type: 'object',
    properties: {
      topics: {
        type: 'array',
        description: 'One entry per numbered post. The index field maps each entry to its post.',
        items: {
          type: 'object',
          properties: {
            index: { type: 'integer', description: 'The post number from its [n] marker (1-based).' },
            topic: { type: 'string', description: '2–4 lowercase words naming the post\'s concept; empty string if none is clear.' },
          },
          required: ['index', 'topic'],
        },
      },
    },
    required: ['topics'],
  },
}

const EXTRACT_TOPICS_BATCH_SYSTEM = `${TOPIC_SYSTEM_PROMPT}

You label MULTIPLE posts in one pass. For EACH numbered post, output a topic label following the rules above. Call the extract_topics tool with one entry per post: its index (matching the [n] marker) and topic. Return an entry for EVERY post.`

export async function extractTopicsBatch(
  posts: Array<{ title: string; selftext: string }>,
  knownTopics: string[],
  priority: number = PRIORITY.NORMAL,
): Promise<(string | null)[]> {
  if (posts.length === 0) return []
  const user =
    `${renderKnownTopics(knownTopics)}Label each of the ${posts.length} numbered posts below. ` +
    `Return exactly one entry per post, matching its [n] number.\n\nPosts:\n\n${renderNumberedPosts(posts)}`
  const maxTokens = Math.min(4096, 200 + posts.length * 40)
  const result = await callStructured(
    MODEL_BULK, EXTRACT_TOPICS_BATCH_SYSTEM, user, EXTRACT_TOPICS_TOOL, maxTokens, priority,
  )
  return normalizeTopicsBatch(result, posts.length)
}

const INSIGHT_SYSTEM_PROMPT = `You analyze Reddit posts to identify business opportunities.

Given a topic label and a list of post titles on that topic, write exactly ONE sentence summarizing the opportunity.

Format: "{Audience} are struggling with {problem} — {opportunity}."

Rules:
- One sentence only
- Concrete and actionable; name a specific audience and a specific opportunity
- No preamble, no quotes, no markdown, no explanation
- Under 200 characters`

export async function summarizeTrend(topic: string, titles: string[]): Promise<string | null> {
  if (titles.length === 0) return null
  const sample = titles.slice(0, 30).map((t) => `- ${t.slice(0, 200)}`).join('\n')
  const userContent = `Topic: ${topic}\n\nPosts:\n${sample}`

  try {
    const msg = await callClaude(() =>
      getClient().messages.create({
        model: MODEL_BULK,
        max_tokens: 120,
        system: INSIGHT_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }],
      })
    )
    const block = msg.content[0]
    if (!block || block.type !== 'text') return null
    const cleaned = block.text.trim().replace(/^["'`]+|["'`]+$/g, '').trim()
    return cleaned.length > 0 ? cleaned : null
  } catch (err) {
    console.error('[claude] summarizeTrend error:', err)
    return null
  }
}

const COMMENT_INSIGHTS_SYSTEM_PROMPT = `You analyze Reddit comments on a single post and extract three things:
1) Tools/products mentioned by name (short tags, lowercased)
2) Verbatim quotes showing buying intent
3) Per-comment classification — for each numbered comment, assign one category

Reply with ONLY valid JSON, no preamble, no markdown, no code fences, in this exact shape:
{
  "tools": ["..."],
  "quotes": [{"text": "...", "type": "wish|switched|would_pay|hate"}],
  "comment_classifications": [{"index": 1, "category": "pain_point|feature_request|tool_complaint|other"}]
}

Rules:
- tools: 0 to 15 distinct names, lowercased, deduped, alphabetized
- quotes: 0 to 8 short verbatim snippets (under 200 chars each), trimmed
- type maps the trigger phrase pattern:
  * "wish" for "I wish/if only/needs/should have"
  * "switched" for "I moved/switched to/replaced X with Y"
  * "would_pay" for "I'd pay/buy/I would pay"
  * "hate" for "I hate/X sucks/X is broken"
- comment_classifications: one entry per comment in the user message, indices matching the 1-based numbering. Use the same categories as posts:
  * pain_point: comment describes a problem or struggle
  * feature_request: comment asks for a feature or improvement
  * tool_complaint: comment complains about a specific tool/library/service
  * other: anything else (general discussion, answers, questions, jokes)
- Empty arrays if nothing relevant. Do not invent.`

export type CommentQuote = {
  text: string
  type: 'wish' | 'switched' | 'would_pay' | 'hate'
}

export type CommentClassification = {
  index: number // 1-based, matches the numbered list in the user message
  category: Category
}

export type CommentInsights = {
  tools: string[]
  quotes: CommentQuote[]
  classifications: CommentClassification[]
}

const VALID_QUOTE_TYPES: ReadonlySet<CommentQuote['type']> = new Set([
  'wish',
  'switched',
  'would_pay',
  'hate',
])

const COMMENT_BODY_TRUNC = 600

function normalizeInsights(raw: unknown): CommentInsights {
  if (typeof raw !== 'object' || raw === null) {
    return { tools: [], quotes: [], classifications: [] }
  }
  const obj = raw as Record<string, unknown>
  const toolsRaw = Array.isArray(obj.tools) ? obj.tools : []
  const quotesRaw = Array.isArray(obj.quotes) ? obj.quotes : []
  const classesRaw = Array.isArray(obj.comment_classifications)
    ? obj.comment_classifications
    : []
  const tools = Array.from(
    new Set(
      toolsRaw
        .filter((t): t is string => typeof t === 'string')
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length > 0 && t.length <= 60),
    ),
  ).slice(0, 15)
  const quotes: CommentQuote[] = []
  for (const q of quotesRaw) {
    if (typeof q !== 'object' || q === null) continue
    const qo = q as Record<string, unknown>
    const text = typeof qo.text === 'string' ? qo.text.trim() : ''
    const type = qo.type as CommentQuote['type']
    if (!text || text.length > 240) continue
    if (!VALID_QUOTE_TYPES.has(type)) continue
    quotes.push({ text, type })
    if (quotes.length >= 8) break
  }
  const classifications: CommentClassification[] = []
  for (const c of classesRaw) {
    if (typeof c !== 'object' || c === null) continue
    const co = c as Record<string, unknown>
    const idx = typeof co.index === 'number' ? Math.floor(co.index) : NaN
    const cat = typeof co.category === 'string' ? (co.category.trim().toLowerCase() as Category) : 'other'
    if (!Number.isFinite(idx) || idx < 1) continue
    classifications.push({ index: idx, category: VALID.has(cat) ? cat : 'other' })
  }
  return { tools, quotes, classifications }
}

const SUGGEST_SUBS_SYSTEM_PROMPT = `You suggest active Reddit subreddits for a market researcher analyzing pain points, tools, and buying signals.

Output exactly 10 subreddit names, one per line:
- no "r/" prefix
- no numbering, bullets, or markdown
- no explanations or extra text
- just the bare names

Pick communities where users actively discuss problems, complaints, tools they use, and feature wishes. Avoid:
- generic mega-subs that are mostly memes or news (e.g. r/funny, r/worldnews)
- banned, quarantined, or inactive subs
- meta-subs about Reddit itself`

const SUB_NAME_RE = /^[a-z0-9_]{2,21}$/i

const SUGGEST_SUBS_TOOL: StructuredTool = {
  name: 'report_subreddits',
  description: 'Return suggested subreddit names (bare, no r/ prefix).',
  input_schema: {
    type: 'object',
    properties: { subreddits: { type: 'array', items: { type: 'string' } } },
    required: ['subreddits'],
  },
}

export async function suggestSubreddits(
  niche: string,
  priority: number = PRIORITY.NORMAL,
): Promise<string[]> {
  const trimmed = niche.trim()
  if (!trimmed) return []

  const input = await callStructured(
    MODEL_BULK,
    SUGGEST_SUBS_SYSTEM_PROMPT,
    `Niche: ${trimmed}`,
    SUGGEST_SUBS_TOOL,
    200,
    priority,
  )
  const raw =
    input && typeof input === 'object' ? (input as Record<string, unknown>).subreddits : null
  if (!Array.isArray(raw)) return []

  const seen = new Set<string>()
  const out: string[] = []
  for (const r of raw) {
    if (typeof r !== 'string') continue
    const cleaned = r
      .trim()
      .replace(/^r\//i, '')
      .replace(/[^a-z0-9_].*$/i, '') // drop anything after the first invalid char
      .toLowerCase()
    if (!cleaned || !SUB_NAME_RE.test(cleaned) || seen.has(cleaned)) continue
    seen.add(cleaned)
    out.push(cleaned)
    if (out.length >= 10) break
  }
  return out
}

const KNOWLEDGE_INSIGHTS_SYSTEM_PROMPT = `You analyze cross-signal market intelligence from Reddit. Your job is to identify NON-OBVIOUS opportunities by connecting signals across topics, tools, and quotes — patterns a human scanning posts one at a time would miss.

Reply with ONLY valid JSON in this exact shape, no markdown, no preamble, no code fences:

{"insights": [
  {
    "insight":     "<one-line summary of the connection in the data>",
    "evidence":    ["<bullet 1>", "<bullet 2>", "..."],
    "opportunity": "<what someone could build, concrete and actionable>",
    "confidence":  "high|medium|low"
  }
]}

Rules:
- Return 3 to 5 insights total.
- Cite specific topics, tools, and counts from the aggregated data in your evidence bullets.
- Skip the obvious. If a tool is mentioned 30 times that's not an insight; the pattern of WHO mentions it and WHAT they're switching from is.
- "confidence" reflects how strong the supporting signal is: "high" when multiple data points triangulate, "medium" when the pattern is clear but thin, "low" when it's a hunch.
- 3-7 evidence bullets per insight, each under 150 chars.
- Be specific. Don't say "users want better tools" — say "5 of the 8 switching quotes move FROM Mailchimp TO Resend, citing deliverability."`

export type KnowledgeInsight = {
  insight: string
  evidence: string[]
  opportunity: string
  confidence: Confidence
}

function normalizeKnowledgeInsights(raw: unknown): KnowledgeInsight[] {
  if (typeof raw !== 'object' || raw === null) return []
  const obj = raw as Record<string, unknown>
  const arr = Array.isArray(obj.insights) ? obj.insights : []
  const out: KnowledgeInsight[] = []
  for (const item of arr) {
    if (typeof item !== 'object' || item === null) continue
    const it = item as Record<string, unknown>
    const insight = typeof it.insight === 'string' ? it.insight.trim() : ''
    const opportunity = typeof it.opportunity === 'string' ? it.opportunity.trim() : ''
    if (!insight || !opportunity) continue
    const evidenceRaw = Array.isArray(it.evidence) ? it.evidence : []
    const evidence = evidenceRaw
      .filter((e): e is string => typeof e === 'string')
      .map((e) => e.trim())
      .filter((e) => e.length > 0 && e.length <= 240)
      .slice(0, 10)
    const conf = typeof it.confidence === 'string' ? (it.confidence.trim().toLowerCase() as Confidence) : 'medium'
    const confidence: Confidence = VALID_CONFIDENCE.has(conf) ? conf : 'medium'
    out.push({ insight, evidence, opportunity, confidence })
    if (out.length >= 5) break
  }
  return out
}

const KNOWLEDGE_INSIGHTS_TOOL: StructuredTool = {
  name: 'report_insights',
  description: 'Return the synthesized cross-signal market insights.',
  input_schema: {
    type: 'object',
    properties: {
      insights: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            insight: { type: 'string' },
            evidence: { type: 'array', items: { type: 'string' } },
            opportunity: { type: 'string' },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          },
          required: ['insight', 'evidence', 'opportunity', 'confidence'],
        },
      },
    },
    required: ['insights'],
  },
}

export async function synthesizeKnowledgeInsights(
  aggregatedText: string,
  model: string = SYNTH_MODELS[DEFAULT_SYNTH_TIER],
): Promise<KnowledgeInsight[]> {
  const input = await callStructured(
    model,
    KNOWLEDGE_INSIGHTS_SYSTEM_PROMPT,
    aggregatedText,
    KNOWLEDGE_INSIGHTS_TOOL,
    2000,
  )
  return normalizeKnowledgeInsights(input)
}

// ─── Insights v2 (decision-grade, cited, critiqued) ──────────────────────────

const INSIGHTS_V2_SYSTEM_PROMPT = `You are a market analyst producing decision-grade opportunity briefs from Reddit signal.

You are given a list of TOP OPPORTUNITIES, each with real demand numbers and concrete evidence lines (a quote followed by its permalink). Write ONE insight per opportunity, in the same order, using ONLY the supplied data.

For each insight:
- title: a crisp, specific opportunity name (not a generic phrase).
- audience: who has this problem (specific role / segment).
- problem: the pain in one or two sentences, in the users' own framing.
- demand: copy the EXACT posts / uniqueAuthors / engagement numbers given for that opportunity.
- momentum: restate the momentum word + the weekly trajectory if shown.
- whatToBuild: a concrete wedge product or feature someone could ship.
- whyNow: why this is timely (momentum, switching, incumbent dissatisfaction).
- evidence: 2-4 entries, each a VERBATIM quote from the provided lines and its EXACT permalink. Never invent a quote or a URL. Only use quotes + links that appear in the input.
- confirmedSources: copy the source list from the opportunity's "confirmed in N source(s)" line exactly.
- topics: copy the opportunity's topic label(s) EXACTLY — the short label on the "### " heading line, and NOTHING from the "demand: …" line below it. Usually one; at most two if the insight clearly merges two adjacent opportunities. These link the insight back to its source posts, so they must match the heading label verbatim — no paraphrasing, no numbers, no suffix.
- confidence: weight cross-source confirmation heavily — high when demand triangulates AND it's confirmed in 2+ sources; medium when the pattern is clear but single-source or thin; low when it's a stretch.

Do not invent opportunities, numbers, quotes, links, or sources. If the evidence for an opportunity is too thin to support an insight, still emit it but set confidence to low.`

const INSIGHT_V2_TOOL: StructuredTool = {
  name: 'report_opportunity_insights',
  description: 'Return one decision-grade insight per supplied opportunity.',
  input_schema: {
    type: 'object',
    properties: {
      insights: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            audience: { type: 'string' },
            problem: { type: 'string' },
            demand: {
              type: 'object',
              properties: {
                posts: { type: 'integer' },
                uniqueAuthors: { type: 'integer' },
                engagement: { type: 'integer' },
              },
              required: ['posts', 'uniqueAuthors', 'engagement'],
            },
            momentum: { type: 'string' },
            whatToBuild: { type: 'string' },
            whyNow: { type: 'string' },
            evidence: {
              type: 'array',
              items: {
                type: 'object',
                properties: { quote: { type: 'string' }, permalink: { type: 'string' } },
                required: ['quote', 'permalink'],
              },
            },
            confirmedSources: { type: 'array', items: { type: 'string' } },
            topics: {
              type: 'array',
              items: { type: 'string' },
              description: "The opportunity's topic heading(s), copied verbatim, used to link back to source posts.",
            },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          },
          required: [
            'title', 'audience', 'problem', 'demand', 'momentum',
            'whatToBuild', 'whyNow', 'evidence', 'confirmedSources', 'topics', 'confidence',
          ],
        },
      },
    },
    required: ['insights'],
  },
}

const CRITIQUE_SYSTEM_PROMPT = `You are a skeptical editor reviewing draft opportunity insights for a founder.

For each draft you receive (numbered), decide:
- keep: false if it's vague, generic, duplicative, or its evidence doesn't actually support the claim (a likely hallucination). keep: true otherwise.
- confidence: recalibrate to high/medium/low based ONLY on how well the cited evidence + demand numbers support the insight. Be conservative — most should be medium or low unless the triangulation is strong.

Return one entry per draft, in order, by its 1-based index. Do not rewrite the insights; only judge them.`

const CRITIQUE_TOOL: StructuredTool = {
  name: 'report_critique',
  description: 'Keep/drop + recalibrated confidence for each draft insight.',
  input_schema: {
    type: 'object',
    properties: {
      verdicts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            index: { type: 'integer' },
            keep: { type: 'boolean' },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          },
          required: ['index', 'keep', 'confidence'],
        },
      },
    },
    required: ['verdicts'],
  },
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}
function int(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0
}

function normalizeInsightsV2(raw: unknown): InsightV2[] {
  if (typeof raw !== 'object' || raw === null) return []
  const arr = Array.isArray((raw as Record<string, unknown>).insights)
    ? ((raw as Record<string, unknown>).insights as unknown[])
    : []
  const out: InsightV2[] = []
  for (const item of arr) {
    if (typeof item !== 'object' || item === null) continue
    const it = item as Record<string, unknown>
    const title = str(it.title, 140)
    if (!title) continue
    const d = (it.demand ?? {}) as Record<string, unknown>
    const evidenceRaw = Array.isArray(it.evidence) ? it.evidence : []
    const evidence: InsightEvidence[] = []
    for (const e of evidenceRaw) {
      if (typeof e !== 'object' || e === null) continue
      const eo = e as Record<string, unknown>
      const quote = str(eo.quote, 280)
      const permalink = str(eo.permalink, 400)
      if (!quote) continue
      evidence.push({ quote, permalink })
      if (evidence.length >= 4) break
    }
    const conf = str(it.confidence, 10).toLowerCase() as Confidence
    const confirmedSources = (Array.isArray(it.confirmedSources) ? it.confirmedSources : [])
      .filter((s): s is string => typeof s === 'string')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 8)
    // The topic label(s) linking this insight to its source posts. If the model
    // copied the whole heading line ("topic — demand: 42 posts, …"), keep only
    // the label before the em-dash. Deduped; canonical matching happens at query
    // time (lib/topics), so minor casing/spelling drift still resolves.
    const topics = Array.from(
      new Set(
        (Array.isArray(it.topics) ? it.topics : [])
          .filter((t): t is string => typeof t === 'string')
          .map((t) => t.split('—')[0].trim())
          .filter(Boolean),
      ),
    ).slice(0, 3)
    out.push({
      title,
      audience: str(it.audience, 160),
      problem: str(it.problem, 600),
      demand: {
        posts: int(d.posts),
        uniqueAuthors: int(d.uniqueAuthors),
        engagement: int(d.engagement),
      },
      momentum: str(it.momentum, 200),
      whatToBuild: str(it.whatToBuild, 600),
      whyNow: str(it.whyNow, 600),
      evidence,
      confirmedSources,
      topics,
      confidence: VALID_CONFIDENCE.has(conf) ? conf : 'medium',
    })
    if (out.length >= 10) break
  }
  return out
}

// One full insight (title/audience/problem/demand/momentum/whatToBuild/whyNow +
// 2-4 cited quotes + sources) runs ~500-700 output tokens; the aggregator feeds
// up to 8 opportunities (TOP_OPPORTUNITIES). 4000 left no headroom — a normal
// 8-opportunity refresh truncated at the ceiling, returning an empty tool call
// and the misleading "Claude returned no insights". 8000 fits 8 comfortably.
const INSIGHTS_DRAFT_MAX_TOKENS = 8000

/**
 * Insights v2: synthesize one cited, decision-grade insight per opportunity,
 * then run a critique pass that drops weak/hallucinated insights and
 * recalibrates confidence. Both passes use schema-enforced tool use.
 */
export async function synthesizeInsightsV2(
  aggregatedText: string,
  model: string = SYNTH_MODELS[DEFAULT_SYNTH_TIER],
  memoryDigest = '',
): Promise<InsightV2[]> {
  const user = memoryDigest ? `${memoryDigest}\n\n${aggregatedText}` : aggregatedText
  const draftInput = await callStructured(
    model,
    INSIGHTS_V2_SYSTEM_PROMPT,
    user,
    INSIGHT_V2_TOOL,
    INSIGHTS_DRAFT_MAX_TOKENS,
  )
  const drafts = normalizeInsightsV2(draftInput)
  if (drafts.length === 0) return []

  // Critique / rank pass — drop weak ones, recalibrate confidence.
  const critiqueUser = drafts
    .map((d, i) => {
      const ev = d.evidence.map((e) => `    • "${e.quote}" (${e.permalink})`).join('\n')
      return (
        `#${i + 1} ${d.title}\n` +
        `  audience: ${d.audience}\n` +
        `  problem: ${d.problem}\n` +
        `  demand: ${d.demand.posts} posts, ${d.demand.uniqueAuthors} authors, engagement ${d.demand.engagement}\n` +
        `  whatToBuild: ${d.whatToBuild}\n` +
        `  evidence:\n${ev || '    (none)'}`
      )
    })
    .join('\n\n')

  const verdictInput = await callStructured(
    model,
    CRITIQUE_SYSTEM_PROMPT,
    critiqueUser,
    CRITIQUE_TOOL,
    1500,
  )
  const verdicts = Array.isArray((verdictInput as Record<string, unknown> | null)?.verdicts)
    ? ((verdictInput as Record<string, unknown>).verdicts as unknown[])
    : []

  if (verdicts.length === 0) return drafts // critique unavailable → keep drafts

  const byIndex = new Map<number, { keep: boolean; confidence: Confidence }>()
  for (const v of verdicts) {
    if (typeof v !== 'object' || v === null) continue
    const vo = v as Record<string, unknown>
    const idx = int(vo.index)
    const keep = vo.keep !== false
    const conf = str(vo.confidence, 10).toLowerCase() as Confidence
    byIndex.set(idx, { keep, confidence: VALID_CONFIDENCE.has(conf) ? conf : 'medium' })
  }

  const kept: InsightV2[] = []
  drafts.forEach((d, i) => {
    const verdict = byIndex.get(i + 1)
    if (verdict && !verdict.keep) return
    kept.push(verdict ? { ...d, confidence: verdict.confidence } : d)
  })
  return kept
}

// ─── Buyer Language extraction ────────────────────────────────────────────────

const BUYER_LANGUAGE_SYSTEM_PROMPT = `You analyze Reddit posts and comments to extract recurring language patterns that signal market opportunities.

From the texts below, extract two things:
1) common_phrases: 10-15 recurring MULTI-WORD expressions people use to describe problems, frustrations, or wishes (e.g. "tired of manually", "wish there was", "drowning in", "stuck dealing with")
2) emotional_language: 10-15 SINGLE WORDS signaling frustration, urgency, or strong feeling (e.g. "nightmare", "hate", "waste", "finally", "stuck", "broken")

For each item, include 1-3 brief sample quotes from the input where it appears (under 150 chars each) with the post_id it came from.

Reply with ONLY valid JSON, no preamble, no markdown, no code fences, in this exact shape:
{
  "common_phrases": [
    {"text": "...", "contexts": [{"quote": "...", "post_id": "..."}]}
  ],
  "emotional_language": [
    {"text": "...", "contexts": [{"quote": "...", "post_id": "..."}]}
  ]
}

Rules:
- Phrases must be 2+ words, lowercase, the exact form people use
- Emotional words: single lowercase words, no punctuation
- Skip generic noise ("the", "and", "post", "comment", "reddit")
- Skip product/tool names — those are tracked separately
- Empty arrays if nothing relevant. Do not invent.`

export type BuyerLanguageContext = {
  quote: string
  post_id: string
}

export type BuyerLanguageItem = {
  text: string
  contexts: BuyerLanguageContext[]
}

export type BuyerLanguageExtraction = {
  commonPhrases: BuyerLanguageItem[]
  emotionalLanguage: BuyerLanguageItem[]
}

function normalizeBuyerLanguageItems(raw: unknown, maxItems: number): BuyerLanguageItem[] {
  if (!Array.isArray(raw)) return []
  const out: BuyerLanguageItem[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const it = item as Record<string, unknown>
    const text = typeof it.text === 'string' ? it.text.trim().toLowerCase() : ''
    if (!text || text.length > 60 || seen.has(text)) continue
    const contextsRaw = Array.isArray(it.contexts) ? it.contexts : []
    const contexts: BuyerLanguageContext[] = []
    for (const c of contextsRaw) {
      if (typeof c !== 'object' || c === null) continue
      const co = c as Record<string, unknown>
      const quote = typeof co.quote === 'string' ? co.quote.trim() : ''
      const post_id = typeof co.post_id === 'string' ? co.post_id.trim() : ''
      if (!quote || quote.length > 200) continue
      contexts.push({ quote, post_id })
      if (contexts.length >= 3) break
    }
    seen.add(text)
    out.push({ text, contexts })
    if (out.length >= maxItems) break
  }
  return out
}

const BL_CONTEXTS_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      quote: { type: 'string' },
      post_id: { type: 'string' },
    },
    required: ['quote', 'post_id'],
  },
} as const

const BUYER_LANGUAGE_TOOL: StructuredTool = {
  name: 'report_buyer_language',
  description: 'Return recurring buyer-language phrases and emotional words with sample contexts.',
  input_schema: {
    type: 'object',
    properties: {
      common_phrases: {
        type: 'array',
        items: {
          type: 'object',
          properties: { text: { type: 'string' }, contexts: BL_CONTEXTS_SCHEMA },
          required: ['text', 'contexts'],
        },
      },
      emotional_language: {
        type: 'array',
        items: {
          type: 'object',
          properties: { text: { type: 'string' }, contexts: BL_CONTEXTS_SCHEMA },
          required: ['text', 'contexts'],
        },
      },
    },
    required: ['common_phrases', 'emotional_language'],
  },
}

export async function extractBuyerLanguage(
  samples: Array<{ post_id: string; text: string }>,
  model: string = SYNTH_MODELS[DEFAULT_SYNTH_TIER],
): Promise<BuyerLanguageExtraction> {
  if (samples.length === 0) return { commonPhrases: [], emotionalLanguage: [] }
  const body = samples
    .map((s) => `[${s.post_id}] ${s.text.replace(/\s+/g, ' ').trim()}`)
    .filter((s) => s.length > 0)
    .join('\n\n')
    .slice(0, 60_000) // safety cap on prompt body

  const input = await callStructured(model, BUYER_LANGUAGE_SYSTEM_PROMPT, body, BUYER_LANGUAGE_TOOL, 3000)
  if (!input || typeof input !== 'object') {
    return { commonPhrases: [], emotionalLanguage: [] }
  }
  const obj = input as Record<string, unknown>
  return {
    commonPhrases: normalizeBuyerLanguageItems(obj.common_phrases, 15),
    emotionalLanguage: normalizeBuyerLanguageItems(obj.emotional_language, 15),
  }
}

// ─── Customer Voice v2: messaging layer ──────────────────────────────────────

const MESSAGING_SYSTEM_PROMPT = `You are a B2B copywriter turning raw Voice-of-Customer data into ready-to-use messaging.

You receive recurring phrases, emotional words, mentioned tools, and a pool of VERBATIM quotes from real users. Build messaging that mirrors how these users actually talk — reuse their exact words.

Produce:
- themes: 3-5 Voice-of-Customer themes (theme name + one-line summary), each backed by 1-3 verbatim source quotes.
- headlines: exactly 3 landing-page headlines built from the users' language.
- landingHero: one hero { headline, subhead }.
- coldOpeners: exactly 3 cold-outreach opening lines that lead with the user's problem (never a pitch).
- adAngles: exactly 3 ad / content angles.
- objections: 2-4 likely objections, each with a short response grounded in the data.
- switchingTriggers: the concrete moments/reasons people switch tools (short phrases).
- willingnessToPay: one or two sentences on price sensitivity / willingness to pay, based only on the signal.

Rules:
- Every "sources" array must contain VERBATIM quotes copied from the supplied pool — never invent quotes.
- Keep copy tight and concrete. No hype, no emojis, no markdown.
- If the data is thin for a field, return fewer items rather than inventing.`

const MSG_ASSET_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      text: { type: 'string' },
      sources: { type: 'array', items: { type: 'string' } },
    },
    required: ['text', 'sources'],
  },
} as const

const MESSAGING_TOOL: StructuredTool = {
  name: 'report_messaging',
  description: 'Return ready-to-use messaging assets built from verbatim Voice-of-Customer quotes.',
  input_schema: {
    type: 'object',
    properties: {
      themes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            theme: { type: 'string' },
            summary: { type: 'string' },
            sources: { type: 'array', items: { type: 'string' } },
          },
          required: ['theme', 'summary', 'sources'],
        },
      },
      headlines: MSG_ASSET_SCHEMA,
      landingHero: {
        type: 'object',
        properties: {
          headline: { type: 'string' },
          subhead: { type: 'string' },
          sources: { type: 'array', items: { type: 'string' } },
        },
        required: ['headline', 'subhead', 'sources'],
      },
      coldOpeners: MSG_ASSET_SCHEMA,
      adAngles: MSG_ASSET_SCHEMA,
      objections: {
        type: 'array',
        items: {
          type: 'object',
          properties: { objection: { type: 'string' }, response: { type: 'string' } },
          required: ['objection', 'response'],
        },
      },
      switchingTriggers: { type: 'array', items: { type: 'string' } },
      willingnessToPay: { type: 'string' },
    },
    required: [
      'themes', 'headlines', 'landingHero', 'coldOpeners',
      'adAngles', 'objections', 'switchingTriggers', 'willingnessToPay',
    ],
  },
}

function normalizeAssets(raw: unknown, max: number): MessagingAsset[] {
  if (!Array.isArray(raw)) return []
  const out: MessagingAsset[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const it = item as Record<string, unknown>
    const text = str(it.text, 300)
    if (!text) continue
    const sources = (Array.isArray(it.sources) ? it.sources : [])
      .filter((s): s is string => typeof s === 'string')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 3)
    out.push({ text, sources })
    if (out.length >= max) break
  }
  return out
}

function normalizeMessaging(raw: unknown): MessagingAssets | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>

  const themesRaw = Array.isArray(o.themes) ? o.themes : []
  const themes = themesRaw
    .filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null)
    .map((t) => ({
      theme: str(t.theme, 120),
      summary: str(t.summary, 280),
      sources: (Array.isArray(t.sources) ? t.sources : [])
        .filter((s): s is string => typeof s === 'string')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 3),
    }))
    .filter((t) => t.theme.length > 0)
    .slice(0, 5)

  const hero = (o.landingHero ?? {}) as Record<string, unknown>
  const objectionsRaw = Array.isArray(o.objections) ? o.objections : []
  const objections = objectionsRaw
    .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
    .map((x) => ({ objection: str(x.objection, 200), response: str(x.response, 300) }))
    .filter((x) => x.objection.length > 0)
    .slice(0, 4)
  const switchingTriggers = (Array.isArray(o.switchingTriggers) ? o.switchingTriggers : [])
    .filter((s): s is string => typeof s === 'string')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 8)

  return {
    themes,
    headlines: normalizeAssets(o.headlines, 3),
    landingHero: {
      headline: str(hero.headline, 160),
      subhead: str(hero.subhead, 280),
      sources: (Array.isArray(hero.sources) ? hero.sources : [])
        .filter((s): s is string => typeof s === 'string')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 3),
    },
    coldOpeners: normalizeAssets(o.coldOpeners, 3),
    adAngles: normalizeAssets(o.adAngles, 3),
    objections,
    switchingTriggers,
    willingnessToPay: str(o.willingnessToPay, 400),
  }
}

/** Build ready-to-use messaging assets from a rendered VoC block. Returns null
 *  when the model produced nothing usable. */
export async function synthesizeMessaging(
  vocText: string,
  model: string = SYNTH_MODELS[DEFAULT_SYNTH_TIER],
  memoryDigest = '',
): Promise<MessagingAssets | null> {
  if (!vocText.trim()) return null
  const user = memoryDigest ? `${memoryDigest}\n\n${vocText}` : vocText
  const input = await callStructured(model, MESSAGING_SYSTEM_PROMPT, user, MESSAGING_TOOL, 3000)
  return normalizeMessaging(input)
}

// ─── Voice engine: positioning + angles + copy, in the buyers' own words ──────
// The headline distillation: one positioning line, the angles that land, and a
// few paste-ready snippets — all grounded in verbatim Voice-of-Customer quotes
// and the founder's profile. Prompt assembly + normalization live in
// lib/voice-brief.ts so they stay unit-testable.

const VOICE_BRIEF_SYSTEM_PROMPT = `You are a positioning strategist for a single founder. You receive how their buyers actually talk (recurring phrases, emotional words, tools, and a pool of VERBATIM quotes) plus the founder's profile. Distill it into the sharpest way for THIS founder to talk about their product — in the buyers' own language.

Produce:
- positioningLine: ONE crisp sentence, UNDER 30 WORDS — what they are, for whom, against what status quo. Tight and opinionated; if it starts to run long, cut it. Not a slogan, not hype, no run-ons.
- angles: 3-5 distinct framings that would land with these buyers. Each: the angle, why it lands (one line), and 2-3 exactWords — verbatim phrases pulled from the supplied quotes.
- snippets: 3-5 paste-ready pieces of copy, each labeled (e.g. "one-liner", "elevator", "cold opener", "landing subhead"). Each carries the verbatim source quotes it draws from.

Rules:
- Every exactWords entry and every snippet "sources" entry must be VERBATIM from the supplied quote pool — never invent language.
- Mirror the buyers' wording. No hype, no emojis, no markdown, no buzzwords.
- If the data is thin for a field, return fewer items rather than inventing.`

const VOICE_BRIEF_TOOL: StructuredTool = {
  name: 'report_voice_brief',
  description: "Return the founder's positioning, resonant angles, and paste-ready copy, grounded in verbatim buyer quotes.",
  input_schema: {
    type: 'object',
    properties: {
      positioningLine: { type: 'string' },
      angles: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            angle: { type: 'string' },
            whyItLands: { type: 'string' },
            exactWords: { type: 'array', items: { type: 'string' } },
          },
          required: ['angle', 'whyItLands', 'exactWords'],
        },
      },
      snippets: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            text: { type: 'string' },
            sources: { type: 'array', items: { type: 'string' } },
          },
          required: ['label', 'text', 'sources'],
        },
      },
    },
    required: ['positioningLine', 'angles', 'snippets'],
  },
}

/** Distill a VoC block + founder profile into a positioning line + angles + copy.
 *  Returns null when the model produced nothing usable. */
export async function synthesizeVoiceBrief(
  vocText: string,
  profileText: string,
  model: string = SYNTH_MODELS[DEFAULT_SYNTH_TIER],
  memoryDigest = '',
): Promise<VoiceBrief | null> {
  if (!vocText.trim()) return null
  const base = buildVoiceInput({ vocText, profileText })
  const user = memoryDigest ? `${memoryDigest}\n\n${base}` : base
  const input = await callStructured(model, VOICE_BRIEF_SYSTEM_PROMPT, user, VOICE_BRIEF_TOOL, 2500)
  return normalizeVoiceBrief(input)
}

// ─── Guided strategist ───────────────────────────────────────────────────────

const STRATEGY_SYSTEM_PROMPT = `You are a pragmatic go-to-market strategist advising a specific founder, using real market intelligence from the subreddits they watch.

Produce a concrete, grounded plan:
- positioning: one or two sentences — how they should position against the market and incumbents.
- icp: the sharpest ideal-customer profile to start with, given their stated ICP + the demand in the data.
- messaging: 3-5 key messages, in the customers' own language where possible.
- distribution: 3-5 channels with a one-line reason each, biased toward the founder's existing channels/skills.
- roadmap: concrete actions for the first 30, 60, and 90 days (3-5 bullets each).
- nextActions: the 5 highest-leverage things to do THIS week, each with a one-line why.
- targetOpportunities: the canonical opportunity topics (verbatim from the intelligence) this plan goes after, so the founder can find leads for them.

Rules:
- Ground every recommendation in the supplied intelligence + profile. Reference specific opportunities, tools, and momentum.
- Respect the founder's stated stage, skills, channels, and constraints. Don't suggest paid ads to a no-budget solo founder, etc.
- Concrete and specific. No fluff, no emojis, no markdown.`

const STRATEGY_TOOL: StructuredTool = {
  name: 'report_strategy',
  description: "Return a grounded go-to-market plan tailored to the founder and market.",
  input_schema: {
    type: 'object',
    properties: {
      positioning: { type: 'string' },
      icp: { type: 'string' },
      messaging: { type: 'array', items: { type: 'string' } },
      distribution: {
        type: 'array',
        items: {
          type: 'object',
          properties: { channel: { type: 'string' }, why: { type: 'string' } },
          required: ['channel', 'why'],
        },
      },
      roadmap: {
        type: 'object',
        properties: {
          thirty: { type: 'array', items: { type: 'string' } },
          sixty: { type: 'array', items: { type: 'string' } },
          ninety: { type: 'array', items: { type: 'string' } },
        },
        required: ['thirty', 'sixty', 'ninety'],
      },
      nextActions: {
        type: 'array',
        items: {
          type: 'object',
          properties: { action: { type: 'string' }, why: { type: 'string' } },
          required: ['action', 'why'],
        },
      },
      targetOpportunities: { type: 'array', items: { type: 'string' } },
    },
    required: [
      'positioning', 'icp', 'messaging', 'distribution',
      'roadmap', 'nextActions', 'targetOpportunities',
    ],
  },
}

function strList(v: unknown, max: number, cap: number): string[] {
  return (Array.isArray(v) ? v : [])
    .filter((s): s is string => typeof s === 'string')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.slice(0, max))
    .slice(0, cap)
}

function normalizeStrategy(raw: unknown): StrategyBrief | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  const roadmap = (o.roadmap ?? {}) as Record<string, unknown>
  const distribution = (Array.isArray(o.distribution) ? o.distribution : [])
    .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
    .map((x) => ({ channel: str(x.channel, 120), why: str(x.why, 240) }))
    .filter((x) => x.channel.length > 0)
    .slice(0, 6)
  const nextActions = (Array.isArray(o.nextActions) ? o.nextActions : [])
    .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
    .map((x) => ({ action: str(x.action, 200), why: str(x.why, 240) }))
    .filter((x) => x.action.length > 0)
    .slice(0, 6)
  const brief: StrategyBrief = {
    positioning: str(o.positioning, 600),
    icp: str(o.icp, 400),
    messaging: strList(o.messaging, 240, 6),
    distribution,
    roadmap: {
      thirty: strList(roadmap.thirty, 200, 6),
      sixty: strList(roadmap.sixty, 200, 6),
      ninety: strList(roadmap.ninety, 200, 6),
    },
    nextActions,
    targetOpportunities: strList(o.targetOpportunities, 120, 8),
  }
  if (!brief.positioning && brief.nextActions.length === 0) return null
  return brief
}

/** Synthesize a grounded go-to-market plan from the assembled strategist
 *  input (profile + market intelligence). Returns null if unusable. */
export async function synthesizeStrategy(
  inputText: string,
  model: string = SYNTH_MODELS[DEFAULT_SYNTH_TIER],
  memoryDigest = '',
): Promise<StrategyBrief | null> {
  if (!inputText.trim()) return null
  const user = memoryDigest ? `${memoryDigest}\n\n${inputText}` : inputText
  const input = await callStructured(model, STRATEGY_SYSTEM_PROMPT, user, STRATEGY_TOOL, 4000)
  return normalizeStrategy(input)
}

// ─── Weekly digest moves ──────────────────────────────────────────────────────

const MOVES_SYSTEM_PROMPT = `You advise a founder on the 3 highest-leverage moves to make THIS week, given a snapshot of their market (top opportunities, accelerating trends, fresh high-intent leads).

Return exactly 3 moves. Each: a concrete action (what to do this week) + a one-line why grounded in the snapshot. Reference specific opportunities/trends/leads. Respect any founder context provided. No fluff, no emojis, no markdown.`

const MOVES_TOOL: StructuredTool = {
  name: 'report_moves',
  description: 'Return the 3 highest-leverage moves for this week.',
  input_schema: {
    type: 'object',
    properties: {
      moves: {
        type: 'array',
        items: {
          type: 'object',
          properties: { move: { type: 'string' }, why: { type: 'string' } },
          required: ['move', 'why'],
        },
      },
    },
    required: ['moves'],
  },
}

export type WeeklyMove = { move: string; why: string }

/** Synthesize the 3 moves for the weekly digest. Returns [] if unusable. */
export async function synthesizeWeeklyMoves(
  contextText: string,
  model: string = SYNTH_MODELS[DEFAULT_SYNTH_TIER],
  memoryDigest = '',
): Promise<WeeklyMove[]> {
  if (!contextText.trim()) return []
  const user = memoryDigest ? `${memoryDigest}\n\n${contextText}` : contextText
  const input = await callStructured(model, MOVES_SYSTEM_PROMPT, user, MOVES_TOOL, 1200)
  const arr = Array.isArray((input as Record<string, unknown> | null)?.moves)
    ? ((input as Record<string, unknown>).moves as unknown[])
    : []
  const out: WeeklyMove[] = []
  for (const m of arr) {
    if (typeof m !== 'object' || m === null) continue
    const mo = m as Record<string, unknown>
    const move = str(mo.move, 240)
    if (!move) continue
    out.push({ move, why: str(mo.why, 240) })
    if (out.length >= 3) break
  }
  return out
}

// ─── Draft reply to a high-intent signal ─────────────────────────────────────

// Same voice as the Leads opener — a real person, not a marketer. Rules live in
// lib/voice.ts so the opener and the reply can never drift apart.
const DRAFT_REPLY_SYSTEM_PROMPT = PERSONA_SYSTEM_PROMPT

export async function draftSignalReply(opts: {
  subreddit: string
  author: string
  text: string
  topic?: string | null
  intentType?: string
  /** Learned "what's working" guidance (which angles convert), if available. */
  guidance?: string | null
  /** The founder's own replies, as a voice anchor (loaded in the route). */
  voiceSamples?: string[]
  /** The founder's distilled positioning, to keep the angle consistent (loaded in the route). */
  voiceBrief?: VoiceBrief | null
  /** Scheduler priority for the underlying Claude call (default NORMAL). */
  priority?: number
  /** Public landing demo: force a short, blunt reply + the brevity persona so the
   *  first thing a visitor reads lands fast. The in-app reply is unaffected. */
  isPublic?: boolean
}): Promise<string | null> {
  const text = opts.text.trim().slice(0, 2000)
  if (!text) return null

  // Fresh shape + voice anchor per draft so replies vary, never a template.
  // The public demo is pinned short + blunt (no sprawling multi-paragraph reply).
  const shape: DraftShape = opts.isPublic ? { length: 'short', angle: 'blunt-take' } : pickShape(text)
  const voiceAnchor = renderVoiceAnchor(selectVoiceSamples(opts.voiceSamples))
  const briefAnchor = renderVoiceBriefAnchor(opts.voiceBrief)

  const userContent =
    `Subreddit: r/${opts.subreddit}\n` +
    `Author: u/${opts.author || 'unknown'}\n` +
    (opts.topic ? `Topic: ${opts.topic}\n` : '') +
    (opts.intentType ? `Intent signal: ${opts.intentType}\n` : '') +
    (opts.guidance ? `What has converted before (lean into this angle): ${opts.guidance.trim()}\n` : '') +
    (briefAnchor ? `\n${briefAnchor}\n` : '') +
    `\n--- Their post/comment ---\n${text}\n--- end ---\n` +
    (voiceAnchor ? `\n${voiceAnchor}\n` : '') +
    `\n${renderShapeDirective(shape)}\n` +
    `\nWrite your reply to u/${opts.author || 'them'}.`

  try {
    const msg = await callClaude(() =>
      getClient().messages.create({
        model: MODEL_BULK,
        max_tokens: opts.isPublic ? 200 : 400,
        temperature: DRAFT_TEMPERATURE,
        system: opts.isPublic ? PERSONA_SYSTEM_PROMPT_SHORT : DRAFT_REPLY_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }],
      }),
      opts.priority ?? PRIORITY.NORMAL,
    )
    const block = msg.content[0]
    if (!block || block.type !== 'text') return null
    const cleaned = block.text.trim().replace(/^["'`]+|["'`]+$/g, '').trim()
    return cleaned.length > 0 ? cleaned : null
  } catch (err) {
    console.error('[claude] draftSignalReply error:', err)
    return null
  }
}

// ─── Draft a first-touch outreach opener for a lead ──────────────────────────
// Sibling to draftSignalReply, tuned for the Leads pipeline: a personalized
// FIRST direct message that leads with the person's problem, mirrors their
// buyer-language phrasing, and never pitches. Prompt assembly lives in
// lib/opener.ts (no server-only) so it stays unit-testable.

export async function draftOpener(opts: OpenerInput): Promise<string | null> {
  const excerpt = (opts.excerpt ?? '').trim()
  if (!excerpt) return null

  // Fresh shape + voice anchor per draft so openers vary, never a template.
  const shape = pickShape(excerpt)
  const voiceSamples = selectVoiceSamples(opts.voiceSamples)
  const userContent = buildOpenerUserContent(opts, { shape, voiceSamples })

  try {
    const msg = await callClaude(() =>
      getClient().messages.create({
        model: MODEL_BULK,
        max_tokens: 400,
        temperature: DRAFT_TEMPERATURE,
        system: OPENER_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }],
      })
    )
    const block = msg.content[0]
    if (!block || block.type !== 'text') return null
    return cleanOpenerText(block.text)
  } catch (err) {
    console.error('[claude] draftOpener error:', err)
    return null
  }
}

// ─── Conversation drafts (Convert #3) — follow-ups + objection responses ─────
// Both go through the schema-enforced tool runner (no regex JSON), grounded in
// the real thread + the founder's offer from business memory.

const DRAFT_MESSAGE_TOOL: StructuredTool = {
  name: 'report_message',
  description: 'Return a single short message to send to the person.',
  input_schema: {
    type: 'object',
    properties: { message: { type: 'string', description: 'The drafted message text.' } },
    required: ['message'],
  },
}

const FOLLOW_UP_SYSTEM_PROMPT = `You write a SHORT follow-up nudge to someone you already messaged on Reddit and who hasn't replied yet.

Rules:
- Add value or a new angle — never "just checking in" or guilt.
- Reference their original problem in their words; stay helpful-first.
- End with one easy, low-pressure question.
- Plain conversational prose, no greeting/sign-off, under 70 words, no emojis.
Return only the message via the report_message tool.`

const OBJECTION_SYSTEM_PROMPT = `You write a brief, honest response to a specific objection a potential buyer has about tools in your space.

Rules:
- Acknowledge the objection as legitimate first — no defensiveness, no hard sell.
- Reframe with a concrete, specific point; it's fine to concede tradeoffs.
- Helpful peer tone, not salesy. Plain prose, no greeting/sign-off, under 70 words, no emojis.
Return only the message via the report_message tool.`

function cleanDraft(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const cleaned = raw.trim().replace(/^["'`]+|["'`]+$/g, '').trim()
  return cleaned.length > 0 ? cleaned : null
}

export async function draftFollowUp(opts: {
  subreddit: string
  author: string
  theirPost: string
  priorMessages?: { role: 'outbound' | 'inbound'; body: string }[]
  offer?: string | null
}): Promise<string | null> {
  const thread = (opts.priorMessages ?? [])
    .map((m) => `${m.role === 'outbound' ? 'You' : 'Them'}: ${m.body}`)
    .join('\n')
  const userContent =
    `Subreddit: r/${opts.subreddit}\n` +
    `Person: u/${opts.author || 'unknown'}\n\n` +
    `Their original post:\n${opts.theirPost.trim().slice(0, 1500)}\n\n` +
    `Conversation so far:\n${thread || '(only your opener has been sent)'}\n` +
    (opts.offer ? `\nWhat you offer (context — don't hard-pitch): ${opts.offer}\n` : '') +
    `\nWrite the follow-up nudge.`
  const out = await callStructured<{ message?: unknown }>(
    MODEL_BULK,
    FOLLOW_UP_SYSTEM_PROMPT,
    userContent,
    DRAFT_MESSAGE_TOOL,
    400,
  )
  return cleanDraft(out?.message)
}

export async function draftObjectionResponse(opts: {
  subreddit: string
  author: string
  objection: string
  theirPost?: string | null
  offer?: string | null
}): Promise<string | null> {
  const userContent =
    `Subreddit: r/${opts.subreddit}\n` +
    `Person: u/${opts.author || 'unknown'}\n` +
    (opts.theirPost ? `\nTheir post:\n${opts.theirPost.trim().slice(0, 1200)}\n` : '') +
    `\nObjection to address: "${opts.objection.trim().slice(0, 300)}"\n` +
    (opts.offer ? `\nWhat you offer (context — don't hard-pitch): ${opts.offer}\n` : '') +
    `\nWrite the response to this objection.`
  const out = await callStructured<{ message?: unknown }>(
    MODEL_BULK,
    OBJECTION_SYSTEM_PROMPT,
    userContent,
    DRAFT_MESSAGE_TOOL,
    400,
  )
  return cleanDraft(out?.message)
}

// ─── Buyer-intent gate (Haiku) — author role ─────────────────────────────────
// Second-pass over intent-matched signals: classify the author's role (buyer /
// maker / discussion) so makers + rants are filtered out. Batched via the tool
// runner — no regex JSON. Relevance is a separate filter (lib/relevance.ts).

const BUYER_INTENT_TOOL: StructuredTool = {
  name: 'report_buyer_intent',
  description: "For each numbered post/comment, report the author's role (buyer / maker / discussion).",
  input_schema: {
    type: 'object',
    properties: {
      verdicts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            index: { type: 'integer', description: '1-based item number' },
            role: { type: 'string', enum: ['buyer', 'maker', 'discussion'] },
            intent: { type: 'string', enum: ['looking-for', 'switching', 'willing-to-pay'] },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          },
          required: ['index', 'role'],
        },
      },
    },
    required: ['verdicts'],
  },
}

/** Classify a batch of signals by author role. Returns a result per input item
 *  (null when the model didn't return a verdict). */
export async function classifyBuyerIntent(
  items: { text: string }[],
): Promise<(BuyerIntentResult | null)[]> {
  if (items.length === 0) return []
  const input = await callStructured(
    MODEL_BULK,
    BUYER_INTENT_SYSTEM_PROMPT,
    buildBuyerIntentInput(items),
    BUYER_INTENT_TOOL,
    1500,
  )
  return normalizeBuyerVerdicts(input, items.length)
}

const RELEVANCE_TOOL: StructuredTool = {
  name: 'report_relevance',
  description: "For each numbered item, report whether it's on the founder's niche AND a potential customer.",
  input_schema: {
    type: 'object',
    properties: {
      verdicts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            index: { type: 'integer', description: '1-based item number' },
            relevant: { type: 'boolean' },
            reason: { type: 'string' },
          },
          required: ['index', 'relevant'],
        },
      },
    },
    required: ['verdicts'],
  },
}

/** Haiku fallback relevance check (used when no embeddings key). Given the
 *  founder's niche, judge each item on-niche + potential customer. */
export async function classifyRelevance(
  items: { text: string }[],
  niche: string,
): Promise<({ relevant: boolean; reason: string } | null)[]> {
  if (items.length === 0) return []
  // Scale the output budget with batch size (one verdict = index + bool + short
  // reason ≈ 50 tokens). A fixed 1500 truncated past ~30 items, leaving the tail
  // unscreened — which the fail-closed hot-signals gate then drops from the hero.
  const maxTokens = Math.min(6000, 400 + items.length * 60)
  const input = await callStructured(
    MODEL_BULK,
    RELEVANCE_SYSTEM_PROMPT,
    buildRelevanceInput(niche, items),
    RELEVANCE_TOOL,
    maxTokens,
  )
  return normalizeRelevanceVerdicts(input, items.length)
}

const COMMENT_INSIGHTS_TOOL: StructuredTool = {
  name: 'report_comment_insights',
  description: 'Return tools mentioned, buying-intent quotes, and per-comment classifications.',
  input_schema: {
    type: 'object',
    properties: {
      tools: { type: 'array', items: { type: 'string' } },
      quotes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            type: { type: 'string', enum: ['wish', 'switched', 'would_pay', 'hate'] },
          },
          required: ['text', 'type'],
        },
      },
      comment_classifications: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            index: { type: 'integer' },
            category: {
              type: 'string',
              enum: ['pain_point', 'feature_request', 'tool_complaint', 'other'],
            },
          },
          required: ['index', 'category'],
        },
      },
    },
    required: ['tools', 'quotes', 'comment_classifications'],
  },
}

export async function extractCommentInsights(
  postTitle: string,
  comments: { body: string }[],
  priority: number = PRIORITY.NORMAL,
): Promise<CommentInsights> {
  if (comments.length === 0) return { tools: [], quotes: [], classifications: [] }
  const numbered = comments
    .map((c, i) => `${i + 1}. ${c.body.trim().slice(0, COMMENT_BODY_TRUNC)}`)
    .join('\n\n')
  const userContent = `Post title: "${postTitle}"\n\nComments (sorted by upvotes):\n${numbered}`

  // Bulk deep-scan extraction — Haiku, but now via schema-enforced tool use.
  const input = await callStructured(
    MODEL_BULK,
    COMMENT_INSIGHTS_SYSTEM_PROMPT,
    userContent,
    COMMENT_INSIGHTS_TOOL,
    1200,
    priority,
  )
  return normalizeInsights(input)
}
