'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchSubPosts,
  fetchCachedPosts,
  type ApiPost,
  type CommentQuote,
  type StreamEvent,
} from './posts-client'
import {
  type ScanState,
  type SubBucket,
  type Stage,
  type TaggedPost,
  type Trend,
  type TrendsTab,
  isStreaming,
  PER_SUB_CAP,
  DONE_FLASH_MS,
  LAST_SCAN_STORAGE_KEY,
} from './scan-types'

type FetchResult =
  | { sub: string; ok: true; nextAfter: string | null }
  | { sub: string; ok: false; error: string; aborted: boolean }

export type DeepScanPatch = {
  tools: string[]
  quotes: CommentQuote[]
  commentsScannedAt: number
  commentsSampled: number
}

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === 'AbortError') ||
    (err instanceof Error && err.name === 'AbortError')
  )
}

async function fetchSubPage(
  sub: string,
  opts: {
    after?: string
    count?: number
    limit?: number
    signal?: AbortSignal
    onEvent?: (event: StreamEvent) => void
    onPost?: (post: ApiPost, index: number) => void
  } = {},
): Promise<FetchResult> {
  try {
    const body = await fetchSubPosts(sub, {
      after: opts.after,
      count: opts.count,
      limit: opts.limit,
      signal: opts.signal,
      onEvent: opts.onEvent,
      onPost: opts.onPost,
    })
    return { sub, ok: true, nextAfter: body.nextAfter }
  } catch (err) {
    // Browsers are inconsistent here: aborting a fetch mid-stream can throw
    // a DOMException AbortError, a generic Error.name === 'AbortError', or a
    // TypeError like "BodyStreamBuffer was aborted". Fall back to checking
    // the signal state directly so any of those paths counts as an abort.
    const aborted = isAbortError(err) || opts.signal?.aborted === true
    return {
      sub,
      ok: false,
      error: aborted ? 'aborted' : err instanceof Error ? err.message : 'Network error',
      aborted,
    }
  }
}

// Append-or-replace a post by id. Backfill re-emits a post with the same id
// but a now-populated topic; we replace the cached-with-null-topic entry.
function mergePost(existing: TaggedPost[], incoming: TaggedPost): TaggedPost[] {
  const i = existing.findIndex((p) => p.id === incoming.id)
  if (i < 0) return [...existing, incoming]
  const out = existing.slice()
  out[i] = incoming
  return out
}

function stageFromEvent(event: StreamEvent): Stage {
  if (event.type === 'status') {
    return {
      kind: 'sizing',
      newCount: event.newCount,
      cachedCount: event.cachedCount,
      backfillCount: event.backfillCount,
    }
  }
  return event.phase === 'classify'
    ? { kind: 'classifying', current: event.current, total: event.total }
    : { kind: 'extracting', current: event.current, total: event.total }
}

function flattenBuckets(buckets: Record<string, SubBucket>, order: string[]): TaggedPost[] {
  const out: TaggedPost[] = []
  for (const sub of order) {
    const b = buckets[sub]
    if (b) out.push(...b.posts)
  }
  out.sort((a, b) => b.analyzedAt - a.analyzedAt)
  return out
}

function computeScanTrends(posts: TaggedPost[]): Trend[] {
  const map = new Map<string, { count: number; subreddits: Set<string> }>()
  for (const post of posts) {
    if (!post.topic) continue
    let entry = map.get(post.topic)
    if (!entry) {
      entry = { count: 0, subreddits: new Set() }
      map.set(post.topic, entry)
    }
    entry.count++
    entry.subreddits.add(post.subreddit)
  }
  return Array.from(map.entries())
    .filter(([, v]) => v.count >= 2)
    .map(([topic, v]) => ({
      topic,
      count: v.count,
      subreddits: Array.from(v.subreddits).sort(),
    }))
    .sort((a, b) => b.count - a.count)
}

export type ScanHook = ReturnType<typeof useScan>

export function useScan(watchlist: string[], hydrated: boolean, postsPerScan: number) {
  const [scan, setScan] = useState<ScanState>({ kind: 'idle' })
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null)
  const [trendsTab, setTrendsTab] = useState<TrendsTab>('scan')
  const [allTimeTrends, setAllTimeTrends] = useState<Trend[] | null>(null)
  const [allTimeLoading, setAllTimeLoading] = useState(false)
  const [allTimeError, setAllTimeError] = useState<string | null>(null)
  const [selectedAllTimeTopic, setSelectedAllTimeTopic] = useState<string | null>(null)
  const [allTimeTopicPosts, setAllTimeTopicPosts] = useState<TaggedPost[] | null>(null)
  const [allTimeTopicLoading, setAllTimeTopicLoading] = useState(false)
  const [allTimeTopicError, setAllTimeTopicError] = useState<string | null>(null)
  const [trendInsight, setTrendInsight] = useState<string | null>(null)
  const [trendInsightLoading, setTrendInsightLoading] = useState(false)
  const [trendInsightError, setTrendInsightError] = useState<string | null>(null)
  const [lastScanAt, setLastScanAt] = useState<number | null>(null)
  // Single controller per scanAll call. stopScan() aborts it; the next
  // scanAll creates a fresh one. Kept in a ref so it doesn't trigger renders.
  const scanControllerRef = useRef<AbortController | null>(null)
  // Tracks which subs we've already fetched cached posts for in this session.
  // A ref (not state) so the lookup is synchronous — the previous
  // setScan-updater-based check ran inside a deferred React update and
  // always evaluated `missing` as empty, silently skipping the init fetch.
  const fetchedSubsRef = useRef<Set<string>>(new Set())
  // Per-post deep-scan loading flag. Keyed by `${sub}:${postId}` so two
  // different posts can be scanning concurrently.
  const [deepScanning, setDeepScanning] = useState<Set<string>>(() => new Set())
  const [deepScanErrors, setDeepScanErrors] = useState<Record<string, string>>({})

  // Bulk deep-scan state: tracks the loop over all eligible posts so the UI
  // can show progress + offer a stop button. `bulkStopRef` is a synchronous
  // signal the loop checks between iterations — stopBulkDeepScan flips it
  // and the loop bails before the next deepScanPost call.
  type BulkDeepScan = { total: number; current: number; active: boolean; stopped: boolean }
  const [bulkDeepScan, setBulkDeepScan] = useState<BulkDeepScan | null>(null)
  const bulkStopRef = useRef(false)

  // Init the last-scan timestamp from localStorage on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LAST_SCAN_STORAGE_KEY)
      if (raw) {
        const n = Number(raw)
        if (Number.isFinite(n)) setLastScanAt(n)
      }
    } catch {}
  }, [])

  // Init load + delta sync: whenever the watchlist changes, fetch cached
  // posts for any sub we haven't fetched yet this session, and drop buckets
  // for removed subs. Pure Supabase read — no Reddit/Claude. Lets trends +
  // posts render on page load without a Scan click.
  useEffect(() => {
    if (!hydrated) return

    // Drop subs the user removed from their watchlist + forget that we
    // fetched them (so re-adding triggers a fresh init load).
    const want = new Set(watchlist)
    for (const sub of fetchedSubsRef.current) {
      if (!want.has(sub)) fetchedSubsRef.current.delete(sub)
    }
    setScan((prev) => {
      if (prev.kind !== 'active') return prev
      const keep = prev.order.filter((s) => want.has(s))
      if (keep.length === prev.order.length) return prev
      const nextBuckets: Record<string, SubBucket> = {}
      for (const sub of keep) nextBuckets[sub] = prev.buckets[sub]
      return { ...prev, buckets: nextBuckets, order: keep }
    })

    if (watchlist.length === 0) return

    // Synchronous check — `missing` is real, not deferred behind a setState
    // updater. Mark optimistically so re-renders don't re-fire the fetch.
    const missing = watchlist.filter((sub) => !fetchedSubsRef.current.has(sub))
    if (missing.length === 0) return
    for (const sub of missing) fetchedSubsRef.current.add(sub)

    fetchCachedPosts(missing)
      .then((bySub) => {
        setScan((prev) => {
          const order = watchlist
          const buckets: Record<string, SubBucket> =
            prev.kind === 'active' ? { ...prev.buckets } : {}
          for (const sub of missing) {
            // Don't clobber a bucket the user has started actively scanning
            // in the few hundred ms since this fetch was kicked off.
            if (buckets[sub]?.stage) continue
            const cached = bySub[sub] ?? []
            buckets[sub] = {
              sub,
              posts: cached.map((p) => ({ ...p, subreddit: sub, index: 0 })),
              nextAfter: null,
              loadingMore: false,
              loadMoreError: null,
            }
          }
          const errors = prev.kind === 'active' ? prev.errors : []
          return { kind: 'active', buckets, order, errors }
        })
      })
      .catch((err: Error) => {
        console.error('[init] cached-posts fetch failed:', err)
        // Let the user retry by clearing the optimistic flag on failure.
        for (const sub of missing) fetchedSubsRef.current.delete(sub)
        setScan((prev) => {
          const order = watchlist
          const buckets: Record<string, SubBucket> =
            prev.kind === 'active' ? { ...prev.buckets } : {}
          for (const sub of missing) {
            if (!buckets[sub]) {
              buckets[sub] = {
                sub,
                posts: [],
                nextAfter: null,
                loadingMore: false,
                loadMoreError: null,
              }
            }
          }
          const errors = prev.kind === 'active' ? prev.errors : []
          return { kind: 'active', buckets, order, errors }
        })
      })
  }, [hydrated, watchlist])

  // Fetch all-time trends on first open of that tab.
  useEffect(() => {
    if (trendsTab !== 'all') return
    if (allTimeTrends !== null || allTimeLoading) return
    setAllTimeLoading(true)
    setAllTimeError(null)
    fetch('/api/trends')
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`)
        setAllTimeTrends(json as Trend[])
      })
      .catch((err: Error) => setAllTimeError(err.message))
      .finally(() => setAllTimeLoading(false))
  }, [trendsTab, allTimeTrends, allTimeLoading])

  // Fetch posts for the selected all-time topic.
  useEffect(() => {
    if (!selectedAllTimeTopic) {
      setAllTimeTopicPosts(null)
      setAllTimeTopicError(null)
      return
    }
    const topic = selectedAllTimeTopic
    setAllTimeTopicLoading(true)
    setAllTimeTopicError(null)
    setAllTimeTopicPosts(null)
    fetch(`/api/posts-by-topic?topic=${encodeURIComponent(topic)}`)
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`)
        const rows = json as Array<Omit<TaggedPost, 'index'>>
        setAllTimeTopicPosts(rows.map((p, i) => ({ ...p, index: i })))
      })
      .catch((err: Error) => setAllTimeTopicError(err.message))
      .finally(() => setAllTimeTopicLoading(false))
  }, [selectedAllTimeTopic])

  // Fetch the cached/generated AI insight when a topic is selected.
  useEffect(() => {
    const topic = selectedTopic ?? selectedAllTimeTopic
    if (!topic) {
      setTrendInsight(null)
      setTrendInsightError(null)
      setTrendInsightLoading(false)
      return
    }
    setTrendInsightLoading(true)
    setTrendInsightError(null)
    setTrendInsight(null)
    fetch(`/api/trend-insight?topic=${encodeURIComponent(topic)}`)
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`)
        setTrendInsight((json as { insight: string }).insight)
      })
      .catch((err: Error) => setTrendInsightError(err.message))
      .finally(() => setTrendInsightLoading(false))
  }, [selectedTopic, selectedAllTimeTopic])

  // Mutual exclusion: only one topic filter active at a time.
  function selectScanTopic(topic: string | null) {
    setSelectedTopic(topic)
    if (topic !== null) setSelectedAllTimeTopic(null)
  }
  function selectAllTimeTopic(topic: string | null) {
    setSelectedAllTimeTopic(topic)
    if (topic !== null) setSelectedTopic(null)
  }

  function updateBucket(sub: string, fn: (b: SubBucket) => SubBucket) {
    setScan((prev) => {
      if (prev.kind !== 'active') return prev
      const b = prev.buckets[sub]
      if (!b) return prev
      return { ...prev, buckets: { ...prev.buckets, [sub]: fn(b) } }
    })
  }

  function appendPost(sub: string, post: ApiPost, index: number) {
    updateBucket(sub, (b) => ({
      ...b,
      posts: mergePost(b.posts, { ...post, subreddit: sub, index }),
    }))
  }

  function recordScanTimestamp() {
    const now = Date.now()
    setLastScanAt(now)
    try {
      localStorage.setItem(LAST_SCAN_STORAGE_KEY, String(now))
    } catch {}
  }

  /**
   * Fire-and-forget call to refresh the weekly trend_snapshots row from the
   * latest posts. Best-effort: failure is logged but never surfaced — the
   * scan results are already saved, only the time-series view goes stale.
   */
  function triggerSnapshotRefresh() {
    fetch('/api/snapshots/refresh', { method: 'POST' }).catch((err) => {
      console.warn('[snapshots] refresh failed:', err)
    })
  }

  async function scanAll() {
    if (watchlist.length === 0) return
    const subs = [...watchlist]

    // Replace any prior controller (a previous in-flight scan, if any) and
    // create a fresh one for this run. The stopScan() handler aborts via this.
    if (scanControllerRef.current) scanControllerRef.current.abort()
    const controller = new AbortController()
    scanControllerRef.current = controller
    const signal = controller.signal

    // Seed any missing buckets, set 'fetching' stage on all subs. Preserves
    // cached posts already loaded by the init effect. Clears any prior
    // 'stopped'/'done'/'failed' stages so the user sees fresh state.
    setScan((prev) => {
      const buckets: Record<string, SubBucket> =
        prev.kind === 'active' ? { ...prev.buckets } : {}
      for (const sub of subs) {
        const existing = buckets[sub]
        buckets[sub] = {
          sub,
          posts: existing?.posts ?? [],
          nextAfter: existing?.nextAfter ?? null,
          loadingMore: false,
          loadMoreError: null,
          stage: { kind: 'fetching' },
        }
      }
      return { kind: 'active', buckets, order: subs, errors: [] }
    })
    setSelectedTopic(null)
    setAllTimeTrends(null)
    recordScanTimestamp()

    await Promise.all(
      subs.map((sub) => {
        const sizingRef: {
          value: { newCount: number; cachedCount: number; backfillCount: number } | null
        } = { value: null }
        // Tracks the latest classify/extract progress count for this sub —
        // used to render 'stopped — X/Y' when the user aborts mid-scan.
        const progressRef = { value: 0 }
        return fetchSubPage(sub, {
          limit: postsPerScan,
          signal,
          onEvent: (event) => {
            if (event.type === 'status') {
              sizingRef.value = {
                newCount: event.newCount,
                cachedCount: event.cachedCount,
                backfillCount: event.backfillCount,
              }
              if (event.newCount + event.backfillCount > 0) {
                updateBucket(sub, (b) => ({ ...b, stage: stageFromEvent(event) }))
              }
            } else {
              // Cumulative count across both phases: classify (1..N) is
              // followed by extract (1..M); add the prior phase's total when
              // we enter backfill so the stopped count reads naturally.
              const sizing = sizingRef.value
              const priorPhaseTotal =
                event.phase === 'backfill' && sizing ? sizing.newCount : 0
              progressRef.value = priorPhaseTotal + event.current
              updateBucket(sub, (b) => ({ ...b, stage: stageFromEvent(event) }))
            }
          },
          onPost: (post, index) => appendPost(sub, post, index),
        }).then((result) => {
          const sizing = sizingRef.value
          const analyzed = sizing ? sizing.newCount + sizing.backfillCount : 0
          const totalThisPage = sizing
            ? sizing.newCount + sizing.cachedCount + sizing.backfillCount
            : 0
          if (result.ok) {
            updateBucket(sub, (b) => ({
              ...b,
              nextAfter: result.nextAfter,
              stage: {
                kind: 'done',
                analyzedCount: analyzed,
                totalCount: totalThisPage,
                allCached: analyzed === 0,
              },
            }))
            setTimeout(
              () => updateBucket(sub, (b) => ({ ...b, stage: undefined })),
              DONE_FLASH_MS,
            )
          } else if (result.aborted) {
            updateBucket(sub, (b) => ({
              ...b,
              stage: {
                kind: 'stopped',
                analyzedCount: progressRef.value,
                totalCount: analyzed,
              },
            }))
            // 'stopped' stays visible until the next scan (clearing happens
            // when scanAll seeds buckets again).
          } else {
            const err = result.error
            updateBucket(sub, (b) => ({
              ...b,
              stage: { kind: 'failed', error: err },
            }))
            setScan((prev) => {
              if (prev.kind !== 'active') return prev
              return { ...prev, errors: [...prev.errors, { sub, error: err }] }
            })
          }
        })
      }),
    )

    if (scanControllerRef.current === controller) {
      scanControllerRef.current = null
    }
    triggerSnapshotRefresh()
  }

  function stopScan() {
    scanControllerRef.current?.abort()
    scanControllerRef.current = null
  }

  async function loadMore(sub: string) {
    let started = false
    setScan((prev) => {
      if (prev.kind !== 'active') return prev
      const b = prev.buckets[sub]
      if (!b || b.loadingMore || b.nextAfter === null || b.posts.length >= PER_SUB_CAP) {
        return prev
      }
      started = true
      return {
        ...prev,
        buckets: {
          ...prev.buckets,
          [sub]: {
            ...b,
            loadingMore: true,
            loadMoreError: null,
            stage: { kind: 'fetching' },
          },
        },
      }
    })
    if (!started) return

    let after: string | null = null
    let countBefore = 0
    setScan((prev) => {
      if (prev.kind === 'active') {
        const b = prev.buckets[sub]
        if (b) {
          after = b.nextAfter
          countBefore = b.posts.length
        }
      }
      return prev
    })

    const sizingRef: {
      value: { newCount: number; cachedCount: number; backfillCount: number } | null
    } = { value: null }

    const result = await fetchSubPage(sub, {
      after: after ?? undefined,
      count: countBefore,
      onEvent: (event) => {
        if (event.type === 'status') {
          sizingRef.value = {
            newCount: event.newCount,
            cachedCount: event.cachedCount,
            backfillCount: event.backfillCount,
          }
          if (event.newCount + event.backfillCount > 0) {
            updateBucket(sub, (b) => ({ ...b, stage: stageFromEvent(event) }))
          }
        } else {
          updateBucket(sub, (b) => ({ ...b, stage: stageFromEvent(event) }))
        }
      },
      onPost: (post, index) => appendPost(sub, post, index),
    })

    const sizing = sizingRef.value
    const analyzed = sizing ? sizing.newCount + sizing.backfillCount : 0
    const totalThisPage = sizing
      ? sizing.newCount + sizing.cachedCount + sizing.backfillCount
      : 0

    if (result.ok) {
      updateBucket(sub, (b) => ({
        ...b,
        nextAfter: result.nextAfter,
        loadingMore: false,
        loadMoreError: null,
        stage: {
          kind: 'done',
          analyzedCount: analyzed,
          totalCount: totalThisPage,
          allCached: analyzed === 0,
        },
      }))
      setTimeout(
        () => updateBucket(sub, (b) => ({ ...b, stage: undefined })),
        DONE_FLASH_MS,
      )
    } else {
      const err = result.error
      updateBucket(sub, (b) => ({
        ...b,
        loadingMore: false,
        loadMoreError: err,
        stage: { kind: 'failed', error: err },
      }))
    }

    setAllTimeTrends(null)
    triggerSnapshotRefresh()
  }

  async function deepScanPost(
    sub: string,
    postId: string,
  ): Promise<DeepScanPatch | null> {
    const key = `${sub}:${postId}`
    setDeepScanning((prev) => {
      if (prev.has(key)) return prev
      const next = new Set(prev)
      next.add(key)
      return next
    })
    setDeepScanErrors((prev) => {
      if (!(key in prev)) return prev
      const { [key]: _omit, ...rest } = prev
      return rest
    })

    try {
      const res = await fetch('/api/deep-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subreddit: sub, postId }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `Deep scan failed: ${res.status}`)
      const insights = json as {
        tools: string[]
        quotes: CommentQuote[]
        commentsScannedAt: number
        commentsSampled: number
      }
      const patch: DeepScanPatch = {
        tools: insights.tools,
        quotes: insights.quotes,
        commentsScannedAt: insights.commentsScannedAt,
        commentsSampled: insights.commentsSampled,
      }
      updateBucket(sub, (b) => ({
        ...b,
        posts: b.posts.map((p) => (p.id === postId ? { ...p, ...patch } : p)),
      }))
      // Also reflect on the all-time topic view if the same post is showing.
      setAllTimeTopicPosts((prev) =>
        prev
          ? prev.map((p) => (p.id === postId && p.subreddit === sub ? { ...p, ...patch } : p))
          : prev,
      )
      return patch
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Deep scan failed'
      setDeepScanErrors((prev) => ({ ...prev, [key]: msg }))
      return null
    } finally {
      setDeepScanning((prev) => {
        if (!prev.has(key)) return prev
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
  }

  const buckets = scan.kind === 'active' ? scan.buckets : {}
  const order = scan.kind === 'active' ? scan.order : []
  const errors = scan.kind === 'active' ? scan.errors : []
  const posts = useMemo(() => flattenBuckets(buckets, order), [buckets, order])

  /**
   * Sequentially deep-scan every post that's eligible (category !== 'other')
   * and not yet scanned (commentsScannedAt === null). Optionally narrows to
   * a single subreddit. Progress is reflected in `bulkDeepScan` so the UI
   * can render a banner with a stop button. Loop bails when the user
   * clicks stop.
   */
  async function deepScanAllEligible(filterSub?: string): Promise<void> {
    const eligible = posts.filter(
      (p) =>
        p.category !== 'other' &&
        p.commentsScannedAt == null &&
        (!filterSub || p.subreddit === filterSub),
    )
    if (eligible.length === 0) return
    if (bulkDeepScan?.active) return // already running

    bulkStopRef.current = false
    setBulkDeepScan({ total: eligible.length, current: 0, active: true, stopped: false })

    for (let i = 0; i < eligible.length; i++) {
      if (bulkStopRef.current) {
        setBulkDeepScan({
          total: eligible.length,
          current: i,
          active: false,
          stopped: true,
        })
        return
      }
      const p = eligible[i]
      // deepScanPost handles its own per-post error tracking, so a failure
      // here just leaves an entry in deepScanErrors and the loop continues
      // with the next post — partial completion is more useful than a
      // hard abort on a flaky single post.
      await deepScanPost(p.subreddit, p.id)
      setBulkDeepScan({
        total: eligible.length,
        current: i + 1,
        active: i + 1 < eligible.length,
        stopped: false,
      })
    }
    // Brief pause showing the completed state, then clear so the banner
    // collapses. 1.2s mirrors the scan-banner done-flash convention.
    setTimeout(() => {
      setBulkDeepScan((prev) => (prev && prev.current === prev.total ? null : prev))
    }, 1200)
  }

  function stopBulkDeepScan() {
    bulkStopRef.current = true
  }

  /** Count of posts that would be deep-scanned if the bulk action ran now.
   *  Memoized so the button label updates as deep scans complete. */
  const eligibleDeepScanCount = useMemo(
    () => posts.filter((p) => p.category !== 'other' && p.commentsScannedAt == null).length,
    [posts],
  )
  const scanTrends = useMemo(() => computeScanTrends(posts), [posts])
  const anyStreaming = useMemo(
    () => Object.values(buckets).some(isStreaming),
    [buckets],
  )

  return {
    scan,
    buckets,
    order,
    errors,
    posts,
    scanTrends,
    anyStreaming,
    selectedTopic,
    selectScanTopic,
    trendsTab,
    setTrendsTab,
    allTimeTrends,
    allTimeLoading,
    allTimeError,
    selectedAllTimeTopic,
    selectAllTimeTopic,
    allTimeTopicPosts,
    allTimeTopicLoading,
    allTimeTopicError,
    trendInsight,
    trendInsightLoading,
    trendInsightError,
    lastScanAt,
    scanAll,
    stopScan,
    loadMore,
    deepScanPost,
    deepScanning,
    deepScanErrors,
    deepScanAllEligible,
    stopBulkDeepScan,
    bulkDeepScan,
    eligibleDeepScanCount,
  }
}
