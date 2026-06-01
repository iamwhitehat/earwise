// Stack Overflow connector — Stack Exchange API (free; works keyless at a low
// quota). We pull UNANSWERED questions: zero answers = pure unmet demand.
// https://api.stackexchange.com/docs/advanced-search
import { stripTags, decodeHtml } from '../reddit-parse'
import type { RawSignal, SourceConnector } from './types'

const SE_ENDPOINT = 'https://api.stackexchange.com/2.3/search/advanced'
const PAGESIZE = 50

type SoItem = {
  question_id?: unknown
  title?: unknown
  body?: unknown
  link?: unknown
  score?: unknown
  answer_count?: unknown
  creation_date?: unknown
  owner?: { display_name?: unknown }
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/** Pure: map a Stack Exchange response into RawSignals. Exported for tests. */
export function parseSoItems(json: unknown): RawSignal[] {
  const items = (json as { items?: unknown })?.items
  if (!Array.isArray(items)) return []
  const out: RawSignal[] = []
  for (const raw of items as SoItem[]) {
    const id = num(raw.question_id)
    const rawTitle = typeof raw.title === 'string' ? raw.title : ''
    const title = decodeHtml(rawTitle).trim()
    if (id == null || !title) continue
    const created = num(raw.creation_date)
    const answers = num(raw.answer_count)
    out.push({
      source: 'stackoverflow',
      externalId: String(id),
      title,
      body: typeof raw.body === 'string' ? decodeHtml(stripTags(raw.body)).slice(0, 4000) : '',
      author: typeof raw.owner?.display_name === 'string' ? raw.owner.display_name : '',
      url: typeof raw.link === 'string' ? raw.link : `https://stackoverflow.com/q/${id}`,
      createdAt: created != null ? created * 1000 : null,
      engagement: { score: num(raw.score), comments: answers },
    })
  }
  return out
}

export const stackoverflowConnector: SourceConnector = {
  id: 'stackoverflow',
  async search(query, signal) {
    const q = query.trim()
    if (!q) return []
    try {
      const params = new URLSearchParams({
        order: 'desc',
        sort: 'creation',
        q,
        answers: '0', // unanswered → unmet demand
        site: 'stackoverflow',
        filter: 'withbody',
        pagesize: String(PAGESIZE),
      })
      const res = await fetch(`${SE_ENDPOINT}?${params.toString()}`, { signal })
      if (!res.ok) return []
      return parseSoItems(await res.json())
    } catch (err) {
      console.warn('[sources/stackoverflow] fetch failed:', err)
      return []
    }
  },
}
