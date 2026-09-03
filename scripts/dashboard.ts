// Local dashboard for the demand scanner.
//
// A plain Node http server — no Next.js, no Supabase, no build step. Serves one
// page, streams scan progress over SSE, and stores results as JSON on disk.
//
//   npx tsx scripts/dashboard.ts        → http://localhost:4321
//
// Binds to 127.0.0.1 only. It holds an Anthropic key and does unauthenticated
// work, so it must not be exposed to a network.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { loadKnowledge, knowledgeStats, topTopics, topTools } from './knowledge'
import { reviewVocabulary } from './review'
import { enrichWithComments, loadComments } from './comments'
import { checkKey, upsertEnv, maskKey } from './provider'
import {
  listSessions, createSession, setActive, renameSession, deleteSession, sessionSummary, activeId,
} from './sessions'
import {
  loadEnv,
  readResult,
  runScan,
  rawSignalsAge,
  corpusStats,
  planSources,
  verifySubreddit,
  collectorHealth,
  outDir,
  type ScanOptions,
} from './scan-core'

const PORT = Number(process.env.PORT ?? 4321)
const HTML = new URL('dashboard.html', import.meta.url)

loadEnv()

let scanning = false
let scanAbort: AbortController | null = null

// The collector runs as a child process so it can be started from the UI. It
// binds to whatever session was active when it launched, which is why switching
// sessions stops it rather than silently retargeting its writes.
let collector: ChildProcess | null = null
let collectorLog: string[] = []
let collectorSession: string | null = null
let enriching = false

function collectorRunning(): boolean {
  return !!collector && collector.exitCode === null && !collector.killed
}

function startCollector(): { ok: boolean; error?: string } {
  if (collectorRunning()) return { ok: false, error: 'collector is already running' }
  const script = fileURLToPath(new URL('collector.ts', import.meta.url))
  try {
    const child = spawn(process.execPath, [...process.execArgv, script], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    collector = child
    collectorLog = []
    collectorSession = activeId()
    const take = (buf: Buffer) => {
      for (const line of buf.toString('utf8').split(/\r?\n/)) {
        if (line.trim()) collectorLog.push(line.trimEnd())
      }
      if (collectorLog.length > 200) collectorLog = collectorLog.slice(-200)
    }
    child.stdout?.on('data', take)
    child.stderr?.on('data', take)
    child.on('exit', (code) => {
      collectorLog.push(`— collector exited (${code ?? 'signal'}) —`)
      collector = null
    })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

function stopCollector(): boolean {
  if (!collectorRunning()) return false
  collector!.kill()
  collector = null
  return true
}

/** Read a JSON body. Keys go in the body, never the query string — a query
 *  string lands in logs and browser history. */
async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>
  } catch {
    return {}
  }
}

function send(res: ServerResponse, code: number, body: unknown, type = 'application/json') {
  const payload = type === 'application/json' ? JSON.stringify(body) : String(body)
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(payload)
}

function parseOptions(url: URL): ScanOptions {
  const list = (k: string) =>
    (url.searchParams.get(k) ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 20)
  const min = Number(url.searchParams.get('minTopicPosts') ?? 2)
  const limit = Number(url.searchParams.get('corpusLimit') ?? 600)
  return {
    subreddits: list('subreddits'),
    hnQueries: list('hnQueries'),
    soQueries: list('soQueries'),
    minTopicPosts: Number.isFinite(min) && min >= 1 ? Math.floor(min) : 2,
    useCorpus: url.searchParams.get('useCorpus') === '1',
    corpusFilter: list('corpusFilter'),
    corpusLimit: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 600,
  }
}

async function handleScan(res: ServerResponse, opts: ScanOptions) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })
  const emit = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  if (scanning) {
    emit('error', { message: 'A scan is already running.' })
    return res.end()
  }
  const total = opts.subreddits.length + opts.hnQueries.length + opts.soQueries.length
  if (!opts.useCorpus && total === 0) {
    emit('error', { message: 'Pick at least one source, or scan the corpus.' })
    return res.end()
  }

  scanning = true
  scanAbort = new AbortController()
  const mine = scanAbort
  // A client that navigates away or closes the tab should not leave a scan
  // billing Haiku calls into a dead socket.
  res.on('close', () => mine.abort())
  // Keep the connection alive through the long Reddit gaps.
  const ping = setInterval(() => res.write(': ping\n\n'), 15_000)
  try {
    const result = await runScan(
      opts,
      (msg) => emit('log', { msg }),
      mine.signal,
      (pr) => emit('progress', pr),
    )
    emit(mine.signal.aborted ? 'cancelled' : 'done', result)
  } catch (err) {
    emit('error', { message: (err as Error).message })
  } finally {
    clearInterval(ping)
    scanning = false
    if (scanAbort === mine) scanAbort = null
    res.end()
  }
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)

  if (url.pathname === '/') {
    if (!existsSync(HTML)) return send(res, 500, 'dashboard.html missing', 'text/plain')
    return send(res, 200, readFileSync(HTML, 'utf8'), 'text/html; charset=utf-8')
  }

  if (url.pathname === '/api/state') {
    return send(res, 200, {
      scanning,
      hasKey: !!process.env.ANTHROPIC_API_KEY,
      keyMasked: process.env.ANTHROPIC_API_KEY ? maskKey(process.env.ANTHROPIC_API_KEY) : null,
      model: process.env.SCAN_MODEL || null,
      rawAgeMs: rawSignalsAge(),
      collector: {
        running: collectorRunning(),
        session: collectorSession,
        log: collectorLog.slice(-12),
      },
      corpus: corpusStats(),
      comments: (() => {
        const c = loadComments()
        const keys = Object.keys(c)
        return { posts: keys.length, withReplies: keys.filter((k) => c[k].length).length }
      })(),
      health: collectorHealth(),
      knowledge: (() => {
        const k = loadKnowledge()
        return { ...knowledgeStats(k), topTopics: topTopics(k, 25), topTools: topTools(k, 15) }
      })(),
      configuredSources: (() => {
        try {
          const c = JSON.parse(
            readFileSync(new URL('collector-sources.json', outDir()), 'utf8'),
          ) as Record<string, string[]>
          return Object.values(c).reduce((n, v) => n + (Array.isArray(v) ? v.length : 0), 0)
        } catch {
          return 0
        }
      })(),
      result: readResult(),
    })
  }

  // Retarget the collector without editing its source. It reads this file at
  // startup, so a change needs a collector restart to take effect.
  if (url.pathname === '/api/collector-sources') {
    const list = (k: string) =>
      (url.searchParams.get(k) ?? '')
        .split(',').map((x) => x.trim()).filter(Boolean).slice(0, 20)
    const cfg = {
      reddit: list('subreddits'),
      hackernews: list('hnQueries'),
      stackoverflow: list('soQueries'),
    }
    const total = cfg.reddit.length + cfg.hackernews.length + cfg.stackoverflow.length
    if (!total) return send(res, 400, { error: 'no sources given' })
    try {
      writeFileSync(new URL('collector-sources.json', outDir()), JSON.stringify(cfg, null, 2))
      return send(res, 200, { saved: true, total })
    } catch (err) {
      return send(res, 500, { error: (err as Error).message })
    }
  }

  // Vocabulary review streams like a scan — it can take a few seconds and the
  // merges it applies are worth watching go by.
  if (url.pathname === '/api/key/check' && req.method === 'POST') {
    const body = await readJson(req)
    const key = typeof body.key === 'string' ? body.key : ''
    if (!key.trim()) return send(res, 400, { error: 'no key given' })
    return send(res, 200, await checkKey(key))
  }

  if (url.pathname === '/api/key/save' && req.method === 'POST') {
    const body = await readJson(req)
    const key = typeof body.key === 'string' ? body.key.trim() : ''
    const model = typeof body.model === 'string' ? body.model.trim() : ''
    const check = await checkKey(key)
    if (!check.ok || !check.provider) {
      return send(res, 400, { error: check.error ?? 'key rejected' })
    }
    const envPath = new URL('../.env.local', import.meta.url)
    const varName =
      check.provider.id === 'anthropic' ? 'ANTHROPIC_API_KEY'
      : check.provider.id === 'voyage' ? 'EMBEDDINGS_API_KEY'
      : `${check.provider.id.toUpperCase()}_API_KEY`
    try {
      let text = ''
      try { text = readFileSync(envPath, 'utf8') } catch { text = '' }
      text = upsertEnv(text, varName, key)
      if (model && check.provider.id === 'anthropic') text = upsertEnv(text, 'SCAN_MODEL', model)
      writeFileSync(envPath, text)
      // Live for this process too, so no restart is needed for the common case.
      process.env[varName] = key
      if (model && check.provider.id === 'anthropic') process.env.SCAN_MODEL = model
      return send(res, 200, {
        saved: true, varName, provider: check.provider, masked: maskKey(key), model: model || null,
      })
    } catch (err) {
      return send(res, 500, { error: (err as Error).message })
    }
  }

  if (url.pathname === '/api/collector/start') {
    const r = startCollector()
    return send(res, r.ok ? 200 : 409, r.ok ? { started: true } : { error: r.error })
  }

  if (url.pathname === '/api/collector/stop') {
    return send(res, 200, { stopped: stopCollector() })
  }

  if (url.pathname === '/api/sessions') {
    const { sessions, activeId } = listSessions()
    return send(res, 200, {
      activeId,
      sessions: sessions.map((x) => ({ ...x, ...sessionSummary(x.id) })),
    })
  }

  if (url.pathname === '/api/sessions/create') {
    if (scanning) return send(res, 409, { error: 'finish or stop the running scan first' })
    const s = createSession(url.searchParams.get('name') ?? '')
    return send(res, 200, { session: s })
  }

  if (url.pathname === '/api/sessions/switch') {
    // Switching mid-scan would write results into the wrong session.
    if (scanning || enriching) {
      return send(res, 409, { error: 'finish or stop the running job first' })
    }
    const wasRunning = collectorRunning()
    if (wasRunning) stopCollector()
    const ok = setActive(url.searchParams.get('id') ?? '')
    return send(res, ok ? 200 : 404, ok ? { switched: true, collectorStopped: wasRunning } : { error: 'no such session' })
  }

  if (url.pathname === '/api/sessions/rename') {
    const ok = renameSession(url.searchParams.get('id') ?? '', url.searchParams.get('name') ?? '')
    return send(res, ok ? 200 : 404, ok ? { renamed: true } : { error: 'no such session' })
  }

  if (url.pathname === '/api/sessions/delete') {
    if (scanning) return send(res, 409, { error: 'finish or stop the running scan first' })
    const ok = deleteSession(url.searchParams.get('id') ?? '')
    return send(res, ok ? 200 : 400, ok ? { deleted: true } : { error: 'cannot delete the last session' })
  }

  if (url.pathname === '/api/comments') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    const emit = (event: string, data: unknown) =>
      res.write(`event: ${event}
data: ${JSON.stringify(data)}

`)
    enriching = true
    try {
      const out = await enrichWithComments((msg) => emit('log', { msg }))
      emit('done', out)
    } catch (err) {
      emit('error', { message: (err as Error).message })
    } finally {
      enriching = false
    }
    return res.end()
  }

  if (url.pathname === '/api/review') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    const emit = (event: string, data: unknown) =>
      res.write(`event: ${event}
data: ${JSON.stringify(data)}

`)
    try {
      const out = await reviewVocabulary((msg) => emit('log', { msg }))
      emit('done', out)
    } catch (err) {
      emit('error', { message: (err as Error).message })
    }
    return res.end()
  }

  if (url.pathname === '/api/cancel') {
    if (scanAbort) {
      scanAbort.abort()
      return send(res, 200, { cancelled: true })
    }
    return send(res, 200, { cancelled: false, reason: 'nothing running' })
  }

  // Streams, because the verification pass is genuinely slow — every named
  // subreddit is checked against Reddit before it is offered.
  // Verify the sources of ONE chosen niche. Spaced, because Reddit throttles.
  if (url.pathname === '/api/verify') {
    const subs = (url.searchParams.get('subreddits') ?? '')
      .split(',').map((x) => x.trim()).filter(Boolean).slice(0, 10)
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    const emit = (event: string, data: unknown) =>
      res.write(`event: ${event}
data: ${JSON.stringify(data)}

`)
    const out: Record<string, string> = {}
    for (const sub of subs) {
      emit('step', { sub })
      out[sub] = await verifySubreddit(sub)
      emit('result', { sub, state: out[sub] })
      await new Promise((r) => setTimeout(r, 1500))
    }
    emit('done', { verified: out })
    return res.end()
  }

  if (url.pathname === '/api/plan') {
    const niche = (url.searchParams.get('niche') ?? '').slice(0, 100)
    const n = Number(url.searchParams.get('count') ?? 5)
    const count = Number.isFinite(n) ? Math.min(6, Math.max(1, Math.floor(n))) : 5
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    const emit = (event: string, data: unknown) =>
      res.write(`event: ${event}
data: ${JSON.stringify(data)}

`)
    try {
      const niches = await planSources(niche, count, (e) => emit('step', e))
      emit('done', { niches })
    } catch (err) {
      emit('error', { message: (err as Error).message })
    }
    return res.end()
  }

  if (url.pathname === '/api/scan') {
    return handleScan(res, parseOptions(url))
  }

  send(res, 404, { error: 'not found' })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  demand scanner → http://localhost:${PORT}`)
  console.log(`  anthropic key: ${process.env.ANTHROPIC_API_KEY ? 'loaded' : 'MISSING from .env.local'}`)
  console.log(`  ctrl-c to stop\n`)
})
