// "Ask your market" (Phase 8) — pure helpers for a natural-language query over
// the indexed signals/posts. Keyword extraction + relevance ranking live here
// (testable); retrieval is in lib/ask-db.ts and synthesis in the route.

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'your', 'you', 'are',
  'how', 'why', 'what', 'who', 'into', 'our', 'their', 'them', 'has', 'have',
  'about', 'are', 'was', 'were', 'they', 'people', 'saying', 'say', 'tell',
  'show', 'give', 'want', 'need', 'whats', 'which', 'where', 'when', 'most',
  'any', 'all', 'can', 'does', 'did', 'will', 'would', 'should', 'a', 'an',
  'of', 'to', 'in', 'on', 'is', 'it', 'or', 'my', 'me', 'do',
])

const KEYWORD_CAP = 8

/** Lowercased, de-duped, stopword-free keywords (≥3 chars) from a free-text query. */
export function extractKeywords(query: string): string[] {
  const seen = new Set<string>()
  for (const raw of query.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || STOPWORDS.has(raw)) continue
    seen.add(raw)
    if (seen.size >= KEYWORD_CAP) break
  }
  return [...seen]
}

export type MarketSource = {
  title: string
  snippet: string
  url: string
  author: string
  subreddit: string
  source: string
}

function overlapScore(s: MarketSource, keywords: string[]): number {
  const hay = `${s.title} ${s.snippet}`.toLowerCase()
  let score = 0
  for (const k of keywords) {
    if (s.title.toLowerCase().includes(k)) score += 2
    else if (hay.includes(k)) score += 1
  }
  return score
}

/** Rank sources by keyword overlap (title hits weighted higher), keep the top N
 *  with at least one hit. Stable for equal scores (preserves input order). */
export function rankSources(
  sources: MarketSource[],
  keywords: string[],
  limit = 12,
): MarketSource[] {
  return sources
    .map((s, i) => ({ s, i, score: overlapScore(s, keywords) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.s)
}

const SNIPPET_CAP = 320

/** Numbered evidence block + question, for the grounded-answer prompt. */
export function buildAskUserContent(query: string, sources: MarketSource[]): string {
  const evidence = sources
    .map((s, i) => {
      const where = s.subreddit ? `r/${s.subreddit}` : s.source
      const body = s.snippet.trim().slice(0, SNIPPET_CAP)
      return `[${i + 1}] (${where}, u/${s.author || 'unknown'}) ${s.title}\n${body}`
    })
    .join('\n\n')
  return (
    `Question: ${query}\n\n` +
    `Evidence from the indexed market (numbered):\n\n${evidence}\n\n` +
    `Answer the question using ONLY this evidence. Cite the [n] items you used.`
  )
}

export const ASK_SYSTEM_PROMPT = `You are a market-research analyst answering a founder's question about what people are saying in their target communities.

Rules:
- Ground every claim in the numbered evidence provided. Do NOT invent facts.
- Be concise and specific — 2–4 sentences, then concrete specifics if useful.
- Reference the evidence you relied on by its number.
- If the evidence doesn't actually answer the question, say so plainly instead of guessing.

Output via the report_answer tool.`

export type AskCitation = {
  n: number
  title: string
  url: string
  subreddit: string
  source: string
}

export type AskResult = {
  answer: string
  citations: AskCitation[]
  scanned: number
}
