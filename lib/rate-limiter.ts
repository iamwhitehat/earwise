// A small priority-aware rate limiter for outbound API calls. One global
// instance gates every Claude request so the app stays under the account's
// requests/min limit (calls START no closer than `minGapMs` apart), while
// letting a user-initiated FOREGROUND call (e.g. "Load more") jump ahead of
// background BULK work (a 100-post deep-scan, cron ingest) instead of queueing
// behind all of it. Bounded concurrency lets a foreground call overlap a slow
// in-flight call (e.g. a 30s Opus synthesis) rather than waiting it out.
//
// Pure — no `server-only` / SDK imports — so the scheduling is unit-testable
// with fake timers. `now`/`setTimer`/`clearTimer` are injectable for tests.

export const PRIORITY = {
  FOREGROUND: 0, // user is waiting on this right now (load-more, a single deep-scan)
  NORMAL: 1, // user-initiated but batchy (a full watchlist scan), and the default
  BULK: 2, // background fan-out (bulk deep-scan loop, cron ingest)
  PUBLIC: 3, // anonymous public funnel traffic — yields to ALL owner work
} as const

export type Priority = (typeof PRIORITY)[keyof typeof PRIORITY]

type Job = {
  priority: number
  seq: number
  run: () => Promise<unknown>
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
}

export type RateLimiter = {
  /** Queue `run` at the given priority; resolves/rejects with its result. */
  schedule<T>(priority: number, run: () => Promise<T>): Promise<T>
  /** Globally hold off the NEXT dispatch for `ms` (used to back off after a 429). */
  pauseFor(ms: number): void
  /** In-flight count (introspection / tests). */
  readonly inFlight: number
  /** Queued (not yet started) count (introspection / tests). */
  readonly queued: number
}

export function createRateLimiter(opts: {
  minGapMs: number
  maxConcurrency: number
  now?: () => number
  setTimer?: (cb: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}): RateLimiter {
  const now = opts.now ?? (() => Date.now())
  const setTimer = opts.setTimer ?? ((cb, ms) => setTimeout(cb, ms))
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
  const minGap = Math.max(0, opts.minGapMs)
  const maxConc = Math.max(1, Math.floor(opts.maxConcurrency))

  const queue: Job[] = []
  let active = 0
  // -Infinity so the very first call dispatches immediately (no startup wait).
  let lastStartAt = -Infinity
  let pausedUntil = 0
  let seq = 0
  let timer: unknown = null

  function pump(): void {
    if (timer !== null) {
      clearTimer(timer)
      timer = null
    }
    if (queue.length === 0 || active >= maxConc) return

    const t = now()
    const earliest = Math.max(lastStartAt + minGap, pausedUntil)
    if (t < earliest) {
      timer = setTimer(pump, earliest - t)
      return
    }

    // Pick the highest priority (lowest number); ties broken FIFO by seq.
    let best = 0
    for (let i = 1; i < queue.length; i++) {
      const c = queue[i]
      const b = queue[best]
      if (c.priority < b.priority || (c.priority === b.priority && c.seq < b.seq)) best = i
    }
    const job = queue.splice(best, 1)[0]

    active++
    lastStartAt = t
    Promise.resolve()
      .then(job.run)
      .then(job.resolve, job.reject)
      .finally(() => {
        active--
        pump()
      })

    // A concurrency slot may remain free; try again. The gap check will gate
    // the next start (so even concurrent calls START at least minGap apart).
    pump()
  }

  return {
    schedule(priority, run) {
      return new Promise((resolve, reject) => {
        queue.push({
          priority,
          seq: seq++,
          run: run as () => Promise<unknown>,
          resolve: resolve as (value: unknown) => void,
          reject,
        })
        pump()
      })
    },
    pauseFor(ms) {
      pausedUntil = Math.max(pausedUntil, now() + Math.max(0, ms))
      // Re-arm so the queue resumes when the pause elapses, even if no job
      // finishes in the meantime.
      pump()
    },
    get inFlight() {
      return active
    },
    get queued() {
      return queue.length
    },
  }
}
