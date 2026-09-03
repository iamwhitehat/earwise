// Comment enrichment.
//
// The connectors read only the post body. That biases the whitespace model in
// one direction: a post asking "what do you use for X" names no tool, so it
// scores as maximum unanswered demand — while the answer sits in the replies it
// received. Measured on a 608-post corpus, 55% of demand posts naming no tool
// were explicitly asking for a recommendation.
//
// Comments live in their own file rather than being merged into corpus.jsonl,
// so the corpus stays a faithful record of what was fetched and enrichment can
// be re-run or thrown away without touching it.
//
// Reddit is deliberately absent: it needs one request per post and we are
// already throttled to near-zero there. Stack Overflow batches 100 ids per
// call, and Hacker News tolerates one call per story.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { outDir, loadCorpus, type Log } from './scan-core'
import { loadKnowledge, saveKnowledge, postKey } from './knowledge'
import { activeId } from './sessions'

const file = () => new URL('comments.json', outDir())

/** postKey -> comment/answer texts. */
export type CommentStore = Record<string, string[]>

export function loadComments(): CommentStore {
  if (!existsSync(file())) return {}
  try {
    return JSON.parse(readFileSync(file(), 'utf8')) as CommentStore
  } catch {
    return {}
  }
}

export function saveComments(c: CommentStore): void {
  writeFileSync(file(), JSON.stringify(c, null, 2))
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Answers for up to 100 Stack Overflow questions in one call. */
async function fetchSoAnswers(ids: string[]): Promise<Record<string, string[]>> {
  const url =
    `https://api.stackexchange.com/2.3/questions/${ids.join(';')}/answers` +
    `?site=stackoverflow&filter=withbody&pagesize=100&sort=votes&order=desc`
  const out: Record<string, string[]> = {}
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) })
  if (!res.ok) return out
  const j = (await res.json()) as { items?: Array<Record<string, unknown>> }
  for (const it of j.items ?? []) {
    const qid = String(it.question_id ?? '')
    const body = typeof it.body === 'string' ? stripHtml(it.body).slice(0, 1200) : ''
    if (!qid || !body) continue
    ;(out[qid] ??= []).push(body)
  }
  return out
}

/** Comments on one Hacker News story. */
async function fetchHnComments(id: string): Promise<string[]> {
  const url = `https://hn.algolia.com/api/v1/search?tags=comment,story_${id}&hitsPerPage=30`
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) })
  if (!res.ok) return []
  const j = (await res.json()) as { hits?: Array<{ comment_text?: unknown }> }
  return (j.hits ?? [])
    .map((h) => (typeof h.comment_text === 'string' ? stripHtml(h.comment_text).slice(0, 1200) : ''))
    .filter(Boolean)
}

export type EnrichResult = {
  scanned: number
  enriched: number
  comments: number
  invalidated: number
  skippedReddit: number
}

/**
 * Fetch comments for corpus posts that do not have them yet. Any post that
 * gains comments has its cached classification dropped, because the old label
 * was decided without half the evidence — leaving it would mean paying for the
 * comments and then ignoring them.
 */
export async function enrichWithComments(
  log: Log,
  signal?: AbortSignal,
  limit = 400,
): Promise<EnrichResult> {
  // Pin the session. activeDir() re-resolves on every call, so a switch during
  // a ten-minute fetch would split reads and writes across two sessions — which
  // is exactly how a run once enriched one corpus and invalidated nothing.
  const startedIn = activeId()
  const stillHere = () => activeId() === startedIn

  const store = loadComments()
  const corpus = loadCorpus()

  const todo = corpus.filter((e) => !store[postKey(e.source, e.externalId)])
  const so = todo.filter((e) => e.source === 'stackoverflow').slice(0, limit)
  const hn = todo.filter((e) => e.source === 'hackernews').slice(0, limit)
  const skippedReddit = todo.filter((e) => e.source === 'reddit').length

  log(`${todo.length} posts without comments — ${so.length} stackoverflow, ${hn.length} hacker news`)
  if (skippedReddit) {
    log(`${skippedReddit} reddit posts skipped — one request each, and we are throttled there`)
  }

  let enriched = 0
  let total = 0

  // Stack Overflow: 100 questions per request.
  for (let i = 0; i < so.length; i += 100) {
    if (signal?.aborted || !stillHere()) break
    const batch = so.slice(i, i + 100)
    try {
      const got = await fetchSoAnswers(batch.map((e) => e.externalId))
      for (const e of batch) {
        const k = postKey(e.source, e.externalId)
        const list = got[e.externalId] ?? []
        store[k] = list
        if (list.length) {
          enriched++
          total += list.length
        }
      }
      log(`stackoverflow ${Math.min(i + 100, so.length)}/${so.length} — ${total} answers so far`)
    } catch (err) {
      log(`stackoverflow batch failed: ${(err as Error).message}`)
    }
    await sleep(1200)
  }

  // Hacker News: one request per story.
  for (let i = 0; i < hn.length; i++) {
    if (signal?.aborted || !stillHere()) break
    const e = hn[i]
    const k = postKey(e.source, e.externalId)
    try {
      const list = await fetchHnComments(e.externalId)
      store[k] = list
      if (list.length) {
        enriched++
        total += list.length
      }
    } catch {
      store[k] = []
    }
    if (i % 10 === 9 || i === hn.length - 1) {
      log(`hacker news ${i + 1}/${hn.length} — ${total} comments so far`)
      saveComments(store)
    }
    await sleep(350)
  }

  if (!stillHere()) {
    log('session changed during the fetch — nothing saved')
    return { scanned: todo.length, enriched: 0, comments: 0, invalidated: 0, skippedReddit }
  }
  saveComments(store)

  // Drop stale classifications so the enriched text actually gets read.
  const k = loadKnowledge()
  let invalidated = 0
  for (const key of Object.keys(store)) {
    if (store[key].length && k.posts[key]) {
      delete k.posts[key]
      invalidated++
    }
  }
  if (invalidated) {
    // Topic counts are rebuilt from the surviving posts so the vocabulary
    // never disagrees with the cache.
    const topics: typeof k.topics = {}
    for (const p of Object.values(k.posts)) {
      if (!p.topic || p.category === 'other') continue
      const t = topics[p.topic] ?? { count: 0, firstSeen: p.at, lastSeen: p.at }
      t.count++
      t.firstSeen = Math.min(t.firstSeen, p.at)
      t.lastSeen = Math.max(t.lastSeen, p.at)
      topics[p.topic] = t
    }
    k.topics = topics
    saveKnowledge(k)
    log(`${invalidated} posts queued for re-reading with their comments`)
  }

  log(`done — ${enriched} posts enriched with ${total} comments`)
  return { scanned: todo.length, enriched, comments: total, invalidated, skippedReddit }
}
