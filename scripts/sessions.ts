// Sessions — one isolated workspace per niche.
//
// A session owns its corpus, its knowledge, its collector config and its last
// result. That isolation is not a filing convenience: the topic vocabulary only
// accumulates inside a coherent domain. Mixing programming, devops and dental
// posts in one corpus produced 185 topics of which 7 recurred, because those
// domains share no language. One session per niche is what makes the learning
// work at all.
//
// Layout:
//   scan-output/sessions.json          index + which one is active
//   scan-output/sessions/<id>/         corpus, knowledge, state, result

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, rmSync, readdirSync } from 'node:fs'

const ROOT = new URL('../scan-output/', import.meta.url)
const INDEX = new URL('sessions.json', ROOT)
const DIR = new URL('sessions/', ROOT)

/** Files a session owns. Also the migration manifest for legacy layouts. */
const SESSION_FILES = [
  'corpus.jsonl',
  'knowledge.json',
  'scan.json',
  'collector-state.json',
  'collector-sources.json',
  'raw-signals.json',
]

export type Session = {
  id: string
  name: string
  createdAt: number
  lastUsedAt: number
}

type Index = { activeId: string; sessions: Session[] }

let counter = 0
function newId(): string {
  counter++
  return `s${Date.now().toString(36)}${counter.toString(36)}`
}

function readIndex(): Index | null {
  if (!existsSync(INDEX)) return null
  try {
    const i = JSON.parse(readFileSync(INDEX, 'utf8')) as Index
    if (!i || !Array.isArray(i.sessions)) return null
    return i
  } catch {
    return null
  }
}

function writeIndex(i: Index): void {
  mkdirSync(ROOT, { recursive: true })
  writeFileSync(INDEX, JSON.stringify(i, null, 2))
}

export function sessionDir(id: string): URL {
  const d = new URL(`${id}/`, DIR)
  mkdirSync(d, { recursive: true })
  return d
}

/**
 * Load the index, creating one on first run. If a pre-sessions layout is found
 * (files sitting directly in scan-output/), it is moved into a session rather
 * than abandoned — that corpus cost real time and money to collect.
 */
function load(): Index {
  const existing = readIndex()
  if (existing && existing.sessions.length) return existing

  mkdirSync(DIR, { recursive: true })
  const legacy = SESSION_FILES.filter((f) => existsSync(new URL(f, ROOT)))
  const id = newId()
  const now = Date.now()
  const session: Session = {
    id,
    name: legacy.length ? 'imported' : 'first session',
    createdAt: now,
    lastUsedAt: now,
  }
  const dir = sessionDir(id)
  for (const f of legacy) {
    try {
      renameSync(new URL(f, ROOT), new URL(f, dir))
    } catch {
      /* a file we cannot move is not worth failing startup over */
    }
  }
  const index: Index = { activeId: id, sessions: [session] }
  writeIndex(index)
  return index
}

export function listSessions(): { sessions: Session[]; activeId: string } {
  const i = load()
  return {
    sessions: [...i.sessions].sort((a, b) => b.lastUsedAt - a.lastUsedAt),
    activeId: i.activeId,
  }
}

export function activeId(): string {
  const i = load()
  // A deleted active id must not wedge the app.
  if (!i.sessions.some((s) => s.id === i.activeId)) {
    i.activeId = i.sessions[0]?.id ?? newId()
    writeIndex(i)
  }
  return i.activeId
}

/** The active session's directory — every data path resolves through this. */
export function activeDir(): URL {
  return sessionDir(activeId())
}

export function createSession(name: string): Session {
  const i = load()
  const now = Date.now()
  const s: Session = {
    id: newId(),
    name: (name || '').trim().slice(0, 60) || 'untitled',
    createdAt: now,
    lastUsedAt: now,
  }
  sessionDir(s.id)
  i.sessions.push(s)
  i.activeId = s.id
  writeIndex(i)
  return s
}

export function setActive(id: string): boolean {
  const i = load()
  const s = i.sessions.find((x) => x.id === id)
  if (!s) return false
  s.lastUsedAt = Date.now()
  i.activeId = id
  writeIndex(i)
  return true
}

export function renameSession(id: string, name: string): boolean {
  const i = load()
  const s = i.sessions.find((x) => x.id === id)
  if (!s) return false
  s.name = (name || '').trim().slice(0, 60) || s.name
  writeIndex(i)
  return true
}

/** Delete a session and its data. Refuses to remove the last one — an app with
 *  no session has nowhere to write. */
export function deleteSession(id: string): boolean {
  const i = load()
  if (i.sessions.length <= 1) return false
  const idx = i.sessions.findIndex((x) => x.id === id)
  if (idx === -1) return false
  i.sessions.splice(idx, 1)
  if (i.activeId === id) i.activeId = i.sessions[0].id
  writeIndex(i)
  try {
    rmSync(new URL(`${id}/`, DIR), { recursive: true, force: true })
  } catch {
    /* index is already updated; orphaned files are harmless */
  }
  return true
}

/** Cheap per-session summary for the sidebar, read straight off disk. */
export function sessionSummary(id: string): { posts: number; topics: number } {
  const dir = new URL(`${id}/`, DIR)
  let posts = 0
  let topics = 0
  try {
    const k = JSON.parse(readFileSync(new URL('knowledge.json', dir), 'utf8')) as {
      posts?: Record<string, unknown>
      topics?: Record<string, unknown>
    }
    posts = Object.keys(k.posts ?? {}).length
    topics = Object.keys(k.topics ?? {}).length
  } catch {
    /* a session with no knowledge yet reports zeroes */
  }
  return { posts, topics }
}

export function sessionIds(): string[] {
  try {
    return readdirSync(DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch {
    return []
  }
}
