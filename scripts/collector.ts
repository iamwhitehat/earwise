// Patient collector — the slow half of the pipeline.
//
// Walks a source list on a long cycle, appending newly-seen posts to an
// append-only corpus. It does NOT classify: collection is free and rate
// limited, classification costs money, so they run on different clocks.
//
//   npx tsx scripts/collector.ts          run until ctrl-c
//   npx tsx scripts/collector.ts --once   one pass over every due source, then exit
//
// Designed to run for weeks. Every decision here favours "still collecting in a
// month" over "more data today" — a blocked IP ends the project, a slow week
// does not.

import { appendFileSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { redditConnector } from '../lib/sources/reddit'
import { hackernewsConnector } from '../lib/sources/hackernews'
import { stackoverflowConnector } from '../lib/sources/stackoverflow'
import { outDir, type CorpusEntry } from './scan-core'
import { listSessions } from './sessions'

const MIN = 60_000
const REQ_TIMEOUT_MS = 20_000

/** Only ever one outbound request per tick, so sources can never bunch up.
 *  Override with TICK_SECONDS for testing — do not shorten it for real runs. */
const TICK_MS = Math.max(1_000, Number(process.env.TICK_SECONDS ?? 60) * 1000)

const CORPUS = new URL('corpus.jsonl', outDir())
const STATE = new URL('collector-state.json', outDir())

// --- sources ----------------------------------------------------------------
// Reddit is the fragile one and the only source that has ever blocked us, so it
// gets the longest interval. HN and Stack Overflow tolerate far more.

type Kind = 'reddit' | 'hackernews' | 'stackoverflow'
type Source = { kind: Kind; query: string; intervalMs: number }

const INTERVALS: Record<Kind, number> = {
  reddit: 25 * MIN,
  hackernews: 45 * MIN,
  stackoverflow: 90 * MIN,
}

const CONFIG = new URL('collector-sources.json', outDir())

const DEFAULTS = {
  reddit: ['webdev', 'SaaS', 'selfhosted', 'devops', 'ExperiencedDevs', 'sysadmin', 'programming'],
  hackernews: ['looking for a tool', 'is there anything that', 'does anyone know of', 'alternative to'],
  stackoverflow: ['recommendation tool', 'best library for'],
}

/** Sources come from scan-output/collector-sources.json when it exists, so the
 *  dashboard can retarget the collector without editing this file. Restart the
 *  collector to pick up a change. */
function loadSources(): { sources: Source[]; fromConfig: boolean } {
  let cfg = DEFAULTS
  let fromConfig = false
  if (existsSync(CONFIG)) {
    try {
      const raw = JSON.parse(readFileSync(CONFIG, 'utf8')) as Partial<typeof DEFAULTS>
      cfg = {
        reddit: Array.isArray(raw.reddit) ? raw.reddit : [],
        hackernews: Array.isArray(raw.hackernews) ? raw.hackernews : [],
        stackoverflow: Array.isArray(raw.stackoverflow) ? raw.stackoverflow : [],
      }
      fromConfig = true
    } catch {
      console.log('  collector-sources.json is unreadable — falling back to defaults')
    }
  }
  const sources: Source[] = []
  for (const kind of ['reddit', 'hackernews', 'stackoverflow'] as Kind[]) {
    for (const query of cfg[kind]) {
      const q = String(query).trim()
      if (q) sources.push({ kind, query: q, intervalMs: INTERVALS[kind] })
    }
  }
  return { sources, fromConfig }
}

const { sources: SOURCES, fromConfig: SOURCES_FROM_CONFIG } = loadSources()

const CONNECTORS = {
  reddit: redditConnector,
  hackernews: hackernewsConnector,
  stackoverflow: stackoverflowConnector,
}

const key = (s: Source) => `${s.kind}:${s.query}`

// --- state ------------------------------------------------------------------

type SourceState = {
  lastRunAt: number
  fails: number
  backoffUntil: number
  fetched: number
  added: number
  /** Consecutive fetches that returned nothing. See ZERO_YIELD_LIMIT. */
  zeroRuns: number
  lastError?: string
}

// The connectors swallow HTTP errors and return [] — a 429 is indistinguishable
// from a quiet feed at the call site. But a live subreddit or search feed
// essentially never returns zero posts, so a run of empties means we are being
// refused. Treat that as a failure and back off, or the collector would keep
// politely knocking on a door that is blocking it, forever.
const ZERO_YIELD_LIMIT = 3

type State = { startedAt: number; ticks: number; sources: Record<string, SourceState> }

function loadState(): State {
  if (existsSync(STATE)) {
    try {
      const s = JSON.parse(readFileSync(STATE, 'utf8')) as State
      if (s && typeof s === 'object' && s.sources) return s
    } catch {
      /* corrupt state is not worth crashing over — start fresh */
    }
  }
  return { startedAt: Date.now(), ticks: 0, sources: {} }
}

function stateFor(st: State, s: Source): SourceState {
  const k = key(s)
  if (!st.sources[k]) {
    st.sources[k] = { lastRunAt: 0, fails: 0, backoffUntil: 0, fetched: 0, added: 0, zeroRuns: 0 }
  }
  return st.sources[k]
}

const saveState = (st: State) => writeFileSync(STATE, JSON.stringify(st, null, 2))

// --- corpus -----------------------------------------------------------------

/** Rebuild the dedup set from disk so restarts don't re-append known posts. */
function loadSeen(): Set<string> {
  const seen = new Set<string>()
  if (!existsSync(CORPUS)) return seen
  for (const line of readFileSync(CORPUS, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      const e = JSON.parse(line) as CorpusEntry
      seen.add(`${e.source}:${e.externalId}`)
    } catch {
      /* skip a torn line rather than lose the whole corpus */
    }
  }
  return seen
}

function append(entries: CorpusEntry[]): void {
  if (!entries.length) return
  appendFileSync(CORPUS, entries.map((e) => JSON.stringify(e)).join('\n') + '\n')
}

// --- collect ----------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const stamp = () => new Date().toISOString().slice(11, 19)

/** Exponential backoff on repeated failure, capped at 4h. */
function backoffMs(fails: number): number {
  return Math.min(5 * MIN * 2 ** (fails - 1), 4 * 60 * MIN)
}

async function fetchOne(s: Source, seen: Set<string>, st: State): Promise<void> {
  const ss = stateFor(st, s)
  const label = `${s.kind}/${s.query}`.padEnd(34)
  try {
    const got = await CONNECTORS[s.kind].search(s.query, AbortSignal.timeout(REQ_TIMEOUT_MS))
    const now = Date.now()
    const fresh: CorpusEntry[] = []
    for (const sig of got) {
      const k = `${sig.source}:${sig.externalId}`
      if (seen.has(k)) continue
      seen.add(k)
      fresh.push({ ...sig, firstSeenAt: now })
    }
    append(fresh)
    ss.fetched += got.length
    ss.added += fresh.length

    if (got.length === 0) {
      ss.zeroRuns++
      if (ss.zeroRuns >= ZERO_YIELD_LIMIT) {
        ss.fails++
        ss.backoffUntil = Date.now() + backoffMs(ss.fails)
        ss.lastError = `${ss.zeroRuns} empty responses — likely throttled`
        const mins = Math.round(backoffMs(ss.fails) / MIN)
        console.log(`${stamp()}  ${label} empty x${ss.zeroRuns} — backing off ${mins}m`)
        ss.lastRunAt = Date.now()
        saveState(st)
        return
      }
    } else {
      ss.zeroRuns = 0
      ss.fails = 0
      ss.backoffUntil = 0
      delete ss.lastError
    }
    console.log(`${stamp()}  ${label} ${String(got.length).padStart(4)} seen, ${String(fresh.length).padStart(4)} new  (corpus ${seen.size})`)
  } catch (err) {
    ss.fails++
    ss.backoffUntil = Date.now() + backoffMs(ss.fails)
    ss.lastError = (err as Error).message
    const mins = Math.round(backoffMs(ss.fails) / MIN)
    console.log(`${stamp()}  ${label} FAILED (${ss.fails}) — backing off ${mins}m — ${ss.lastError}`)
  }
  ss.lastRunAt = Date.now()
  saveState(st)
}

/** The source that has been waiting longest past its interval, or null. */
function pickDue(st: State): Source | null {
  const now = Date.now()
  let best: Source | null = null
  let bestOverdue = 0
  for (const s of SOURCES) {
    const ss = stateFor(st, s)
    if (now < ss.backoffUntil) continue
    const overdue = now - (ss.lastRunAt + s.intervalMs)
    if (overdue >= 0 && overdue >= bestOverdue) {
      best = s
      bestOverdue = overdue
    }
  }
  return best
}

async function main() {
  const once = process.argv.includes('--once')
  const st = loadState()
  const seen = loadSeen()

  const { sessions, activeId } = listSessions()
  const active = sessions.find((x) => x.id === activeId)
  console.log(`\n  patient collector — session "${active?.name ?? activeId}"`)
  console.log(`  ${SOURCES.length} sources ${SOURCES_FROM_CONFIG ? '(from collector-sources.json)' : '(defaults)'}`)
  console.log(`  one request per ${TICK_MS / 1000}s at most`)
  console.log(`  corpus: ${seen.size} posts already collected`)
  console.log(`  ${once ? 'single pass (--once)' : 'running until ctrl-c'}\n`)

  let stopping = false
  process.on('SIGINT', () => {
    console.log('\n  stopping — state saved')
    stopping = true
    saveState(st)
    process.exit(0)
  })

  if (!SOURCES.length) {
    console.log('  no sources configured — set them in the dashboard, or delete')
    console.log('  scan-output/collector-sources.json to use the defaults\n')
    return
  }

  if (once) {
    // One pass: every source that is currently due, spaced by TICK_MS.
    let s: Source | null
    while ((s = pickDue(st)) !== null && !stopping) {
      await fetchOne(s, seen, st)
      if (pickDue(st)) await sleep(TICK_MS)
    }
    console.log(`\n  pass complete — corpus ${seen.size} posts`)
    return
  }

  for (;;) {
    if (stopping) return
    st.ticks++
    const s = pickDue(st)
    if (s) await fetchOne(s, seen, st)
    saveState(st)
    await sleep(TICK_MS)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
