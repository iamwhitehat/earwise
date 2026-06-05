import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRateLimiter, PRIORITY } from './rate-limiter'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
})
afterEach(() => {
  vi.useRealTimers()
})

// Records the wall-clock time each job STARTS, so we can assert spacing + order.
function recorder() {
  const starts: Array<{ label: string; at: number }> = []
  const job = (label: string, durationMs = 0) => async () => {
    starts.push({ label, at: Date.now() })
    if (durationMs > 0) await new Promise((r) => setTimeout(r, durationMs))
    return label
  }
  return { starts, order: () => starts.map((s) => s.label), times: () => starts.map((s) => s.at), job }
}

describe('createRateLimiter', () => {
  it('spaces dispatch starts by at least minGapMs (serial)', async () => {
    const rl = createRateLimiter({ minGapMs: 100, maxConcurrency: 1 })
    const rec = recorder()
    const done = Promise.all([
      rl.schedule(PRIORITY.NORMAL, rec.job('a')),
      rl.schedule(PRIORITY.NORMAL, rec.job('b')),
      rl.schedule(PRIORITY.NORMAL, rec.job('c')),
    ])
    await vi.advanceTimersByTimeAsync(500)
    await expect(done).resolves.toEqual(['a', 'b', 'c'])
    expect(rec.times()).toEqual([0, 100, 200])
  })

  it('allows up to maxConcurrency in flight, still start-spaced', async () => {
    const rl = createRateLimiter({ minGapMs: 100, maxConcurrency: 2 })
    const rec = recorder()
    // Each job runs for 1000ms, far longer than the 100ms gap.
    const done = Promise.all([
      rl.schedule(PRIORITY.NORMAL, rec.job('a', 1000)),
      rl.schedule(PRIORITY.NORMAL, rec.job('b', 1000)),
      rl.schedule(PRIORITY.NORMAL, rec.job('c', 1000)),
    ])
    await vi.advanceTimersByTimeAsync(100) // a@0, b@100
    expect(rec.order()).toEqual(['a', 'b'])
    expect(rl.inFlight).toBe(2) // both still running
    expect(rl.queued).toBe(1) // c blocked by concurrency cap
    await vi.advanceTimersByTimeAsync(1000) // a/b finish ~1000/1100; c starts when a slot frees
    await vi.advanceTimersByTimeAsync(2000)
    await done
    expect(rec.times()).toEqual([0, 100, 1000])
  })

  it('lets a higher-priority job jump ahead of queued lower-priority work', async () => {
    const rl = createRateLimiter({ minGapMs: 100, maxConcurrency: 1 })
    const rec = recorder()
    // a (BULK) dispatches immediately; b (BULK) + c (FOREGROUND) queue. c must
    // run before b despite being enqueued later.
    const done = Promise.all([
      rl.schedule(PRIORITY.BULK, rec.job('a')),
      rl.schedule(PRIORITY.BULK, rec.job('b')),
      rl.schedule(PRIORITY.FOREGROUND, rec.job('c')),
    ])
    await vi.advanceTimersByTimeAsync(500)
    await done
    expect(rec.order()).toEqual(['a', 'c', 'b'])
  })

  it('FIFO within the same priority (by enqueue order)', async () => {
    const rl = createRateLimiter({ minGapMs: 10, maxConcurrency: 1 })
    const rec = recorder()
    const done = Promise.all(
      ['a', 'b', 'c', 'd'].map((l) => rl.schedule(PRIORITY.NORMAL, rec.job(l))),
    )
    await vi.advanceTimersByTimeAsync(100)
    await done
    expect(rec.order()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('pauseFor holds off the next dispatch (429 backoff)', async () => {
    const rl = createRateLimiter({ minGapMs: 100, maxConcurrency: 1 })
    const rec = recorder()
    const first = rl.schedule(PRIORITY.NORMAL, rec.job('a'))
    await vi.advanceTimersByTimeAsync(0) // a@0
    rl.pauseFor(500)
    const second = rl.schedule(PRIORITY.NORMAL, rec.job('b'))
    await vi.advanceTimersByTimeAsync(300)
    expect(rec.order()).toEqual(['a']) // b still paused
    await vi.advanceTimersByTimeAsync(300) // crosses t=500
    await Promise.all([first, second])
    expect(rec.times()).toEqual([0, 500])
  })

  it('propagates resolution and rejection of the wrapped task', async () => {
    const rl = createRateLimiter({ minGapMs: 0, maxConcurrency: 1 })
    const ok = rl.schedule(PRIORITY.NORMAL, async () => 42)
    const bad = rl.schedule(PRIORITY.NORMAL, async () => {
      throw new Error('boom')
    })
    // Subscribe to the rejection BEFORE advancing timers so it's never an
    // "unhandled rejection" in the brief window before we await it.
    const badAssertion = expect(bad).rejects.toThrow('boom')
    await vi.advanceTimersByTimeAsync(10)
    await expect(ok).resolves.toBe(42)
    await badAssertion
  })

  it('drains a large mixed-priority batch with no stuck jobs', async () => {
    const rl = createRateLimiter({ minGapMs: 5, maxConcurrency: 3 })
    const rec = recorder()
    const jobs: Array<Promise<string>> = []
    for (let i = 0; i < 30; i++) {
      const prio = i % 3 === 0 ? PRIORITY.FOREGROUND : i % 3 === 1 ? PRIORITY.NORMAL : PRIORITY.BULK
      jobs.push(rl.schedule(prio, rec.job(`j${i}`, 20)))
    }
    await vi.advanceTimersByTimeAsync(5000)
    await Promise.all(jobs)
    expect(rec.starts).toHaveLength(30)
    expect(rl.inFlight).toBe(0)
    expect(rl.queued).toBe(0)
  })
})
