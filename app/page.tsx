'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { computeOpportunity } from '@/lib/scan-types'
import {
  Breakdown,
  BuyerLanguageSummary,
  CategoryGroups,
  CommentCoverage,
  AdvantageOpportunityCard,
  ErrorsBanner,
  ExportButtons,
  FirstRunGuide,
  OpportunityCard,
  PostCard,
  ScanBanner,
  Topbar,
  TrendDetailPanel,
  VolumeCard,
  WhatsWorkingPanel,
  useDropStaleScanTopic,
  type BuyerLanguageData,
  type CommentStats,
  type InsightState,
} from './_components/components'
import { useScanCtx, useWatchlistCtx } from './_components/scan-provider'
import { Icons, Spinner } from './_components/icons'
import { STARTER_PRESETS } from '@/lib/use-watchlist'
import { canonicalTopic } from '@/lib/topics'
import type { WeekSnapshot } from '@/lib/snapshots'
import type { MaterializedOpportunity } from '@/lib/advantage'

const TOP_N = 3
const FRESH_LIMIT = 6

/**
 * Maps a fetch error message to the SETUP.md migration that's most likely
 * responsible. Returns null when the error doesn't look like a missing-
 * column / missing-table case. Pattern matches what the API routes already
 * surface as their error.message.
 */
type MigrationKind = 'comments' | 'snapshots'
function migrationHintFor(error: string, kind: MigrationKind): { id: string; what: string } | null {
  const missing =
    /column\s+\w+\.\w+\s+does not exist/i.test(error) ||
    /relation\s+"?\w+"?\s+does not exist/i.test(error)
  if (!missing) return null
  if (kind === 'comments') {
    return { id: '2b-quater', what: 'comment-stats tables (post_comments, num_comments)' }
  }
  return { id: '2b-septies', what: 'trend_snapshots table' }
}

function SilentFailureLine({
  label,
  error,
  migration,
}: {
  label: string
  error: string
  migration: { id: string; what: string } | null
}) {
  return (
    <span>
      <span style={{ color: 'var(--ink-3)' }}>{label}:</span> {error}
      {migration && (
        <>
          {' — '}
          <span
            title={`See SETUP.md section ${migration.id} (${migration.what})`}
            style={{ fontWeight: 600, color: 'var(--tool)' }}
          >
            run SETUP.md §{migration.id}
          </span>
        </>
      )}
    </span>
  )
}

function DashboardView() {
  const wl = useWatchlistCtx()
  const scan = useScanCtx()
  const router = useRouter()
  const sp = useSearchParams()

  // URL is the source of truth for the opened topic — `?topic=foo` survives
  // refresh, is shareable, and round-trips through browser back/forward.
  const urlTopic = sp.get('topic')

  // Applies a topic selection: writes URL and updates context together so a
  // click flips both atomically (no one-frame flash where the URL says foo
  // but the panel hasn't opened yet). Also used by useDropStaleScanTopic.
  const applyTopic = useCallback(
    (topic: string | null) => {
      scan.selectScanTopic(topic)
      const next = new URLSearchParams(sp.toString())
      if (topic) next.set('topic', topic)
      else next.delete('topic')
      const qs = next.toString()
      // replace() (not push()) — toggling the same panel shouldn't pile up
      // history entries to back-button through.
      router.replace(qs ? `/?${qs}` : '/', { scroll: false })
    },
    [router, sp, scan],
  )

  // Sync URL → context for changes the click handlers didn't make: deep
  // links on first load, browser back/forward. The handler already keeps
  // them in sync during normal use, so this no-ops most of the time.
  useEffect(() => {
    if (urlTopic !== scan.selectedTopic) {
      scan.selectScanTopic(urlTopic)
    }
    // Intentional: only react to URL change, not every context update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlTopic])

  // First-run guide: shown when this is a genuinely fresh dashboard — no
  // classified posts, no scan in flight, never scanned before. Once any of
  // those flips, the guide disappears and the normal sections take over.
  // Gated on `wl.hydrated` so we don't flash the guide before localStorage
  // (and the starter watchlist seed) has settled.
  const showFirstRunGuide =
    wl.hydrated &&
    scan.posts.length === 0 &&
    !scan.anyStreaming &&
    scan.lastScanAt == null

  useDropStaleScanTopic(scan.selectedTopic, scan.scanTrends, applyTopic)

  // Top 3 opportunity topics, ranked by score.
  const topOpps = useMemo(
    () =>
      scan.scanTrends
        .map((t) => computeOpportunity(scan.posts, t.topic))
        .sort((a, b) => b.scoreRaw - a.scoreRaw)
        .slice(0, TOP_N),
    [scan.scanTrends, scan.posts],
  )
  const topTopics = useMemo(() => topOpps.map((o) => o.topic), [topOpps])

  // Pre-fetch AI insights for the top 3.
  const [insights, setInsights] = useState<Record<string, InsightState>>({})
  useEffect(() => {
    const missing = topTopics.filter((t) => !insights[t])
    if (missing.length === 0) return
    setInsights((prev) => {
      const next = { ...prev }
      for (const t of missing) next[t] = { status: 'loading' }
      return next
    })
    for (const topic of missing) {
      fetch(`/api/trend-insight?topic=${encodeURIComponent(topic)}`)
        .then(async (res) => {
          const json = await res.json()
          if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`)
          setInsights((prev) => ({
            ...prev,
            [topic]: { status: 'ready', insight: (json as { insight: string }).insight },
          }))
        })
        .catch((err: Error) => {
          setInsights((prev) => ({
            ...prev,
            [topic]: { status: 'error', error: err.message },
          }))
        })
    }
  }, [topTopics, insights])

  // Pre-fetch trend snapshots for the top topics — drives the direction
  // badges on each opportunity card. One batched HTTP call, refetched when
  // the top-topic set changes.
  const [topicSnapshots, setTopicSnapshots] = useState<Record<string, WeekSnapshot[]>>({})
  const [snapshotsError, setSnapshotsError] = useState<string | null>(null)
  useEffect(() => {
    if (topTopics.length === 0) return
    const need = topTopics.filter((t) => !(t in topicSnapshots))
    if (need.length === 0) return
    const params = new URLSearchParams({ topics: need.join(','), weeks: '8' })
    setSnapshotsError(null)
    fetch(`/api/snapshots?${params}`)
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`)
        const map = json as Record<string, WeekSnapshot[]>
        setTopicSnapshots((prev) => ({ ...prev, ...map }))
      })
      .catch((err: Error) => {
        // Snapshots table may not exist yet, or scan hasn't run.
        console.warn('[dashboard] snapshot fetch failed:', err.message)
        setSnapshotsError(err.message)
        // Mark as fetched (empty) so we don't retry every render.
        setTopicSnapshots((prev) => {
          const next = { ...prev }
          for (const t of need) next[t] = next[t] ?? []
          return next
        })
      })
  }, [topTopics, topicSnapshots])

  // Cross-source confirmation — canonical topic → distinct sources. Empty
  // until the signals table exists; failures are non-fatal (Reddit-only).
  const [confirmation, setConfirmation] = useState<Record<string, string[]>>({})
  useEffect(() => {
    let cancelled = false
    fetch('/api/sources/confirmation')
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!cancelled && json?.confirmation) setConfirmation(json.confirmation as Record<string, string[]>)
      })
      .catch(() => {
        /* signals table may be absent — Reddit-only view, non-fatal */
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Materialized Advantage-ranked opportunities (Phase 4). When present they
  // are the headline ranking; otherwise the dashboard falls back to the
  // in-memory computeOpportunity ranking below. Auto-populates once when the
  // table is empty but posts exist.
  const [advOpps, setAdvOpps] = useState<MaterializedOpportunity[] | null>(null)
  const triedMaterialize = useRef(false)
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/opportunities')
        if (!res.ok) return
        const json = (await res.json()) as { opportunities?: MaterializedOpportunity[] }
        let opps = json.opportunities ?? []
        // Empty table + we have data to rank → materialize once, then re-read.
        if (opps.length === 0 && scan.posts.length > 0 && !triedMaterialize.current) {
          triedMaterialize.current = true
          const r = await fetch('/api/opportunities/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
          if (r.ok) opps = ((await r.json()) as { opportunities?: MaterializedOpportunity[] }).opportunities ?? []
        }
        if (!cancelled) setAdvOpps(opps)
      } catch {
        /* opportunities table may be absent — fall back, non-fatal */
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [scan.posts.length])

  // Freshness indicator for the materialized opportunities (most recent row).
  const advOppsFreshness = useMemo(() => {
    const newest = (advOpps ?? []).reduce((max, o) => Math.max(max, o.updatedAt ?? 0), 0)
    if (!newest) return null
    const diff = Date.now() - newest
    if (diff < 3_600_000) return `updated ${Math.max(1, Math.floor(diff / 60_000))}m ago`
    if (diff < 86_400_000) return `updated ${Math.floor(diff / 3_600_000)}h ago`
    return `updated ${Math.floor(diff / 86_400_000)}d ago`
  }, [advOpps])

  // Comment scan stats — small rollup for the compact CommentCoverage line.
  const [commentStats, setCommentStats] = useState<CommentStats | null>(null)
  const [commentStatsError, setCommentStatsError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    fetch('/api/comment-stats')
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`)
        if (!cancelled) setCommentStats(json as CommentStats)
      })
      .catch((err: Error) => {
        console.warn('[dashboard] comment-stats fetch failed:', err.message)
        if (!cancelled) setCommentStatsError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Buyer Language — cached payload + manual refresh.
  // Dashboard shows the cached summary only — refresh lives on /language.
  const [buyerLanguage, setBuyerLanguage] = useState<BuyerLanguageData | null>(null)
  const [blLoading, setBlLoading] = useState(true)
  const [blError, setBlError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    setBlLoading(true)
    fetch('/api/buyer-language')
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`)
        if (!cancelled) setBuyerLanguage(json as BuyerLanguageData | null)
      })
      .catch((err: Error) => {
        if (!cancelled) setBlError(err.message)
      })
      .finally(() => {
        if (!cancelled) setBlLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const filteredPosts = scan.selectedTopic
    ? scan.posts.filter((p) => canonicalTopic(p.topic) === scan.selectedTopic)
    : scan.posts

  // Fresh Signals: latest non-other posts, sorted by newest.
  const fresh = useMemo(
    () =>
      scan.posts
        .filter((p) => p.category !== 'other')
        .sort((a, b) => b.analyzedAt - a.analyzedAt)
        .slice(0, FRESH_LIMIT),
    [scan.posts],
  )

  // Reuse the pre-fetched insight when the selected card is one of the top 3.
  const selectedInsightState = scan.selectedTopic ? insights[scan.selectedTopic] : null
  const detailInsight =
    selectedInsightState?.status === 'ready' ? selectedInsightState.insight! : scan.trendInsight
  const detailInsightLoading =
    selectedInsightState?.status === 'loading' || scan.trendInsightLoading
  const detailInsightError =
    selectedInsightState?.status === 'error'
      ? selectedInsightState.error!
      : scan.trendInsightError

  return (
    <>
      <Topbar title="Dashboard" posts={scan.posts}>
        {scan.anyStreaming ? (
          <button type="button" className="btn btn-danger btn-sm" onClick={scan.stopScan}>
            <Icons.stop size={14} /> Stop
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={scan.scanAll}
            // Same condition as the sidebar's Scan button: scanning is only
            // gated on having something to scan. Empty watchlist → disabled;
            // everything else (first run, errors, no prior scan) is fine.
            disabled={wl.watchlist.length === 0}
          >
            <Icons.scan size={14} /> Scan
          </button>
        )}
      </Topbar>

      <div className="content scroll">
        <ErrorsBanner errors={scan.errors} />
        {scan.anyStreaming && <ScanBanner buckets={scan.buckets} order={scan.order} />}

        {(commentStatsError || snapshotsError) && (
          <div
            className="card fade-in"
            style={{
              padding: '12px 16px',
              marginBottom: 'var(--gap)',
              background: 'var(--tool-bg)',
              borderColor: 'oklch(0.85 0.08 65)',
              color: 'var(--ink-2)',
              fontSize: 12.5,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <strong style={{ color: 'var(--tool)' }}>
              Some dashboard panels couldn&apos;t load
            </strong>
            {commentStatsError && (
              <SilentFailureLine
                label="Comment coverage"
                error={commentStatsError}
                migration={migrationHintFor(commentStatsError, 'comments')}
              />
            )}
            {snapshotsError && (
              <SilentFailureLine
                label="Trend direction badges"
                error={snapshotsError}
                migration={migrationHintFor(snapshotsError, 'snapshots')}
              />
            )}
          </div>
        )}

        {showFirstRunGuide ? (
          <FirstRunGuide
            watchlist={wl.watchlist}
            onScan={scan.scanAll}
            scanning={scan.anyStreaming}
            presets={STARTER_PRESETS}
            onApplyPreset={wl.applyPreset}
          />
        ) : advOpps && advOpps.length > 0 ? (
          <section className="section">
            <div className="section-head">
              <h2>Top Opportunities</h2>
              <span className="pill">ranked by Advantage</span>
              <span className="hint">
                expected value for you — tap a card to explain
                {advOppsFreshness ? ` · ${advOppsFreshness}` : ''}
              </span>
              <ExportButtons
                filenameStem="opportunities"
                disabled={advOpps.length === 0}
                build={() => ({
                  headers: ['rank', 'topic', 'advantage', 'demand', 'monetization', 'momentum', 'whitespace', 'fit_to_you', 'posts', 'sources'],
                  rows: advOpps.map((o, i) => [
                    String(i + 1),
                    o.topic,
                    o.advantage.toFixed(3),
                    o.demand.toFixed(2),
                    o.monetization.toFixed(2),
                    o.momentum.toFixed(2),
                    o.whitespace.toFixed(2),
                    o.fitToYou.toFixed(2),
                    String(o.posts),
                    o.confirmedSources.join('; '),
                  ]),
                })}
              />
            </div>
            <div className="opp-grid">
              {advOpps.slice(0, 6).map((opp, i) => (
                <AdvantageOpportunityCard
                  key={opp.topic}
                  opp={opp}
                  rank={i}
                  selected={scan.selectedTopic === opp.topic}
                  onSelect={() =>
                    applyTopic(scan.selectedTopic === opp.topic ? null : opp.topic)
                  }
                />
              ))}
            </div>
          </section>
        ) : (
          <section className="section">
            <div className="section-head">
              <h2>Top Opportunities</h2>
              <span className="pill">ranked by score</span>
              <span className="hint">Highest-signal problems worth building for</span>
              <ExportButtons
                filenameStem="opportunities"
                disabled={topOpps.length === 0}
                build={() => ({
                  headers: ['rank', 'topic', 'score', 'posts', 'pain', 'feature', 'tool_complaint', 'subreddits'],
                  rows: topOpps.map((opp, i) => [
                    String(i + 1),
                    opp.topic,
                    opp.scoreRaw.toFixed(2),
                    String(opp.total),
                    String(opp.painCount),
                    String(opp.featureCount),
                    String(opp.toolCount),
                    opp.subreddits.join('; '),
                  ]),
                })}
              />
            </div>
            {topOpps.length === 0 ? (
              <div className="card empty fade-in">
                <span className="e-ico">
                  <Icons.radar size={26} />
                </span>
                <div>
                  No trending topics yet. Add subs on <a href="/explore">Explore</a> and run a scan to
                  surface opportunities.
                </div>
              </div>
            ) : (
              <div className="opp-grid">
                {topOpps.map((opp, i) => (
                  <OpportunityCard
                    key={opp.topic}
                    opp={opp}
                    rank={i}
                    selected={scan.selectedTopic === opp.topic}
                    onSelect={() =>
                      applyTopic(scan.selectedTopic === opp.topic ? null : opp.topic)
                    }
                    insight={insights[opp.topic]}
                    snapshots={topicSnapshots[opp.topic]}
                    confirmedSources={confirmation[opp.topic]}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {!showFirstRunGuide && <WhatsWorkingPanel />}

        {commentStats && (
          <div style={{ marginBottom: 'var(--gap)' }}>
            <CommentCoverage stats={commentStats} />
          </div>
        )}

        <BuyerLanguageSummary data={buyerLanguage} loading={blLoading} error={blError} />

        {scan.selectedTopic ? (
          <section className="section">
            <TrendDetailPanel
              topic={scan.selectedTopic}
              posts={filteredPosts}
              insight={detailInsight ?? null}
              insightLoading={detailInsightLoading}
              insightError={detailInsightError}
              onClear={() => applyTopic(null)}
            />
            <CategoryGroups posts={filteredPosts} />
          </section>
        ) : (
          <div className="cols">
            <section className="section" style={{ marginBottom: 0 }}>
              <div className="section-head">
                <h2>Fresh Signals</h2>
                <span className="hint">Latest classified posts</span>
              </div>
              <div className="card">
                {fresh.length === 0 ? (
                  <div className="empty">
                    <span className="e-ico">
                      <Spinner size={20} color="var(--ink-4)" />
                    </span>
                    <div>No classified posts yet. Run a scan to populate signals.</div>
                  </div>
                ) : (
                  fresh.map((post) => (
                    <PostCard
                      key={`${post.subreddit}:${post.id}`}
                      post={post}
                      compact
                    />
                  ))
                )}
              </div>
            </section>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap)' }}>
              <section style={{ marginBottom: 0 }}>
                <div className="section-head">
                  <h2>Signal Volume</h2>
                </div>
                <VolumeCard posts={scan.posts} />
              </section>
              <section style={{ marginBottom: 0 }}>
                <div className="section-head">
                  <h2>By Category</h2>
                </div>
                <Breakdown posts={scan.posts} />
              </section>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

function DashboardFallback() {
  return (
    <>
      <Topbar title="Dashboard" posts={[]} />
      <div className="content scroll">
        <div className="empty" style={{ padding: 24 }}>
          <Spinner size={16} color="var(--ink-3)" /> Loading dashboard…
        </div>
      </div>
    </>
  )
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardFallback />}>
      <DashboardView />
    </Suspense>
  )
}
