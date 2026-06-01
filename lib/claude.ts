import 'server-only'

import Anthropic from '@anthropic-ai/sdk'
import { type Category } from './categories'
import {
  OPENER_SYSTEM_PROMPT,
  buildOpenerUserContent,
  cleanOpenerText,
  type OpenerInput,
} from './opener'

export type { Category }

const VALID: ReadonlySet<Category> = new Set([
  'pain_point',
  'feature_request',
  'tool_complaint',
  'other',
])

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
// 1.5s gap between successful Claude calls = ~40 req/min, safely under the
// 50 req/min tier. Queue is shared across the whole process, so concurrent
// per-subreddit requests all serialize through the same gate.
//
// On 429: pause the entire queue for 60s before retrying. We retry up to twice
// inside the same slot, so other waiters back off too (they would also 429).

const MIN_GAP_MS = 1500
const RETRY_DELAY_MS = 60_000
const MAX_RETRIES = 2

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

let chain: Promise<unknown> = Promise.resolve()

async function throttle<T>(fn: () => Promise<T>): Promise<T> {
  const prev = chain
  let release!: () => void
  chain = new Promise<void>((r) => { release = r })
  try {
    await prev.catch(() => {})
    return await fn()
  } finally {
    setTimeout(release, MIN_GAP_MS)
  }
}

function isRateLimit(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { status?: number }).status === 429
}

async function callClaude<T>(make: () => Promise<T>): Promise<T> {
  return throttle(async () => {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await make()
      } catch (err) {
        if (!isRateLimit(err) || attempt === MAX_RETRIES) throw err
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

export type Confidence = 'high' | 'medium' | 'low'

export type ClassificationExample = {
  title: string
  snippet: string // first ~100 chars of body, may be empty for link posts
}

export type ExampleSet = Record<Category, ClassificationExample[]>

export type Classification = { category: Category; confidence: Confidence }

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

function parseClassification(text: string): Classification {
  const tryParse = (raw: string): Classification | null => {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (typeof parsed !== 'object' || parsed === null) return null
      const obj = parsed as Record<string, unknown>
      const cat = typeof obj.category === 'string' ? (obj.category.trim().toLowerCase() as Category) : null
      const conf = typeof obj.confidence === 'string' ? (obj.confidence.trim().toLowerCase() as Confidence) : null
      const category = cat && VALID.has(cat) ? cat : 'other'
      const confidence = conf && VALID_CONFIDENCE.has(conf) ? conf : 'medium'
      return { category, confidence }
    } catch {
      return null
    }
  }
  const direct = tryParse(text.trim())
  if (direct) return direct
  const m = text.match(/\{[\s\S]*\}/)
  if (m) {
    const obj = tryParse(m[0])
    if (obj) return obj
  }
  return { category: 'other', confidence: 'medium' }
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
        model: 'claude-haiku-4-5',
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

function normalizeTopic(raw: string): string | null {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[.,;:!?'"`()[\]{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return null
  const words = cleaned.split(' ')
  if (words.length < 1 || words.length > 6) return null
  if (cleaned.length > 60) return null
  return cleaned
}

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
        model: 'claude-haiku-4-5',
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
        model: 'claude-haiku-4-5',
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

export async function suggestSubreddits(niche: string): Promise<string[]> {
  const trimmed = niche.trim()
  if (!trimmed) return []

  try {
    const msg = await callClaude(() =>
      getClient().messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 200,
        system: SUGGEST_SUBS_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `Niche: ${trimmed}` }],
      })
    )
    const block = msg.content[0]
    if (!block || block.type !== 'text') return []
    return parseSubList(block.text)
  } catch (err) {
    console.error('[claude] suggestSubreddits error:', err)
    return []
  }
}

function parseSubList(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const cleaned = raw
      .trim()
      .replace(/^[-*\d.\s)]+/, '') // strip list markers / numbering
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

export async function synthesizeKnowledgeInsights(
  aggregatedText: string,
): Promise<KnowledgeInsight[]> {
  try {
    const msg = await callClaude(() =>
      getClient().messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 2000,
        system: KNOWLEDGE_INSIGHTS_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: aggregatedText }],
      })
    )
    const block = msg.content[0]
    if (!block || block.type !== 'text') return []
    const text = block.text.trim()
    try {
      return normalizeKnowledgeInsights(JSON.parse(text))
    } catch {
      const m = text.match(/\{[\s\S]*\}/)
      if (m) {
        try {
          return normalizeKnowledgeInsights(JSON.parse(m[0]))
        } catch {}
      }
      console.warn(
        '[claude] synthesizeKnowledgeInsights: unparseable JSON:',
        text.slice(0, 300),
      )
      return []
    }
  } catch (err) {
    console.error('[claude] synthesizeKnowledgeInsights error:', err)
    return []
  }
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

export async function extractBuyerLanguage(
  samples: Array<{ post_id: string; text: string }>,
): Promise<BuyerLanguageExtraction> {
  if (samples.length === 0) return { commonPhrases: [], emotionalLanguage: [] }
  const body = samples
    .map((s, i) => `[${s.post_id}] ${s.text.replace(/\s+/g, ' ').trim()}`)
    .filter((s) => s.length > 0)
    .join('\n\n')
    .slice(0, 60_000) // safety cap on prompt body

  try {
    const msg = await callClaude(() =>
      getClient().messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 3000,
        system: BUYER_LANGUAGE_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: body }],
      })
    )
    const block = msg.content[0]
    if (!block || block.type !== 'text') {
      return { commonPhrases: [], emotionalLanguage: [] }
    }
    const text = block.text.trim()
    const parse = (raw: string): BuyerLanguageExtraction | null => {
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>
        return {
          commonPhrases: normalizeBuyerLanguageItems(parsed.common_phrases, 15),
          emotionalLanguage: normalizeBuyerLanguageItems(parsed.emotional_language, 15),
        }
      } catch {
        return null
      }
    }
    const direct = parse(text)
    if (direct) return direct
    const m = text.match(/\{[\s\S]*\}/)
    if (m) {
      const fallback = parse(m[0])
      if (fallback) return fallback
    }
    console.warn('[claude] extractBuyerLanguage: unparseable JSON:', text.slice(0, 300))
    return { commonPhrases: [], emotionalLanguage: [] }
  } catch (err) {
    console.error('[claude] extractBuyerLanguage error:', err)
    return { commonPhrases: [], emotionalLanguage: [] }
  }
}

// ─── Draft reply to a high-intent signal ─────────────────────────────────────

const DRAFT_REPLY_SYSTEM_PROMPT = `You write helpful, non-spammy replies to Reddit posts and comments.
Goal: be useful first, never lead with a product pitch.

Structure your reply:
1. Acknowledge their specific problem in one sentence (mirror their language).
2. Share an angle that's worked — describe an approach, not a brand.
3. End with a clarifying question OR an offer to share more.

Rules:
- Plain Reddit-style prose, no markdown headers.
- Under 100 words.
- Never recommend a specific product by name unless the user asked for one.
- Don't sound like a sales pitch.
- No emojis.

Output ONLY the reply text. No preamble, no quotes, no commentary.`

export async function draftSignalReply(opts: {
  subreddit: string
  author: string
  text: string
  topic?: string | null
  intentType?: string
}): Promise<string | null> {
  const text = opts.text.trim().slice(0, 2000)
  if (!text) return null

  const userContent =
    `Subreddit: r/${opts.subreddit}\n` +
    `Author: u/${opts.author || 'unknown'}\n` +
    (opts.topic ? `Topic: ${opts.topic}\n` : '') +
    (opts.intentType ? `Intent signal: ${opts.intentType}\n` : '') +
    `\n--- Their post/comment ---\n${text}\n--- end ---\n\n` +
    `Draft a helpful Reddit reply that addresses their actual problem. Lead with their pain, not a pitch.`

  try {
    const msg = await callClaude(() =>
      getClient().messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 400,
        system: DRAFT_REPLY_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }],
      })
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

  const userContent = buildOpenerUserContent(opts)

  try {
    const msg = await callClaude(() =>
      getClient().messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 400,
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

export async function extractCommentInsights(
  postTitle: string,
  comments: { body: string }[],
): Promise<CommentInsights> {
  if (comments.length === 0) return { tools: [], quotes: [], classifications: [] }
  const numbered = comments
    .map((c, i) => `${i + 1}. ${c.body.trim().slice(0, COMMENT_BODY_TRUNC)}`)
    .join('\n\n')
  const userContent = `Post title: "${postTitle}"\n\nComments (sorted by upvotes):\n${numbered}`

  try {
    const msg = await callClaude(() =>
      getClient().messages.create({
        model: 'claude-haiku-4-5',
        // Budget covers tools + quotes + ~20 classification entries.
        max_tokens: 1200,
        system: COMMENT_INSIGHTS_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }],
      })
    )
    const block = msg.content[0]
    if (!block || block.type !== 'text') return { tools: [], quotes: [], classifications: [] }
    const text = block.text.trim()
    try {
      return normalizeInsights(JSON.parse(text))
    } catch {
      // Sometimes the model wraps in code fences despite the prompt. Try to
      // pull the first {...} block.
      const m = text.match(/\{[\s\S]*\}/)
      if (m) {
        try { return normalizeInsights(JSON.parse(m[0])) } catch {}
      }
      console.warn('[claude] extractCommentInsights: unparseable JSON:', text.slice(0, 200))
      return { tools: [], quotes: [], classifications: [] }
    }
  } catch (err) {
    console.error('[claude] extractCommentInsights error:', err)
    return { tools: [], quotes: [], classifications: [] }
  }
}
