'use client'

import { useEffect, useState } from 'react'
import { Icons, Spinner } from '../_components/icons'
import { useScanCtx } from '../_components/scan-provider'
import { DirectionBadge, Topbar } from '../_components/components'
import type { WeekSnapshot } from '@/lib/snapshots'

const CHART_WEEKS = 8
const TOP_TOPICS_IN_CHART = 6

type Insight = {
  insight: string
  evidence: string[]
  opportunity: string
  confidence: 'high' | 'medium' | 'low'
}

type Stats = {
  postCount: number
  deepScanCount: number
  topTopics: Array<{ topic: string; count: number }>
}

type Snapshot = {
  id: number
  insights: Insight[]
  stats: Stats
  generatedAt: number
} | null

function formatAgo(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

function confidenceClass(c: 'high' | 'medium' | 'low'): string {
  if (c === 'high') return 'score-high'
  if (c === 'medium') return 'score-mid'
  return 'score-low'
}

export default function InsightsPage() {
  const scan = useScanCtx()
  const [snapshot, setSnapshot] = useState<Snapshot>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch('/api/insights')
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`)
        if (!cancelled) setSnapshot(json as Snapshot)
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleRefresh() {
    if (refreshing) return
    setRefreshing(true)
    setError(null)
    try {
      const res = await fetch('/api/insights/refresh', { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`)
      setSnapshot(json as Snapshot)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh failed')
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <>
      <Topbar title="Insights" posts={scan.posts}>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={handleRefresh}
          disabled={refreshing}
        >
          {refreshing ? (
            <>
              <Spinner size={13} /> Synthesizing…
            </>
          ) : (
            <>
              <Icons.sparkles size={14} /> Refresh insights
            </>
          )}
        </button>
      </Topbar>

      <div className="content scroll">
        {loading && !snapshot && (
          <div className="card" style={{ padding: 'var(--pad)' }}>
            <div className="skel" style={{ height: 16, marginBottom: 8 }} />
            <div className="skel" style={{ height: 14, width: '70%' }} />
          </div>
        )}

        {error && (
          <div
            className="card"
            style={{
              padding: '14px 17px',
              marginBottom: 'var(--gap)',
              background: 'var(--pain-bg)',
              borderColor: 'oklch(0.9 0.05 22)',
              color: 'var(--ink-2)',
              fontSize: 13,
            }}
          >
            <strong style={{ color: 'var(--pain)' }}>Error:</strong> {error}
          </div>
        )}

        {!loading && !snapshot && !error && (
          <div className="card empty fade-in">
            <span className="e-ico">
              <Icons.sparkles size={28} />
            </span>
            <div>
              No insights yet. Click <strong>Refresh insights</strong> to analyze your
              data — Claude will look for non-obvious connections across topics,
              tools, and buying-intent quotes.
            </div>
          </div>
        )}

        {snapshot && (
          <>
            <div
              className="card fade-in"
              style={{
                padding: '12px 16px',
                marginBottom: 'var(--gap)',
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                flexWrap: 'wrap',
              }}
            >
              <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>
                Last generated{' '}
                <span style={{ color: 'var(--ink)', fontWeight: 500 }}>
                  {formatAgo(snapshot.generatedAt)}
                </span>{' '}
                · from{' '}
                <span className="tnum" style={{ color: 'var(--ink)', fontWeight: 500 }}>
                  {snapshot.stats.postCount}
                </span>{' '}
                posts and{' '}
                <span className="tnum" style={{ color: 'var(--ink)', fontWeight: 500 }}>
                  {snapshot.stats.deepScanCount}
                </span>{' '}
                deep scans
              </span>
            </div>

            <TrendsOverTime
              topics={snapshot.stats.topTopics
                .slice(0, TOP_TOPICS_IN_CHART)
                .map((t) => t.topic)}
            />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap)', marginTop: 30 }}>
              {snapshot.insights.map((ins, i) => (
                <InsightCard key={i} insight={ins} index={i} />
              ))}
            </div>
          </>
        )}
      </div>
    </>
  )
}

// "Trends Over Time" — fetches the last 8 weeks of snapshots for the top
// topics from the most recent insights run and renders one mini bar chart
// per topic. Custom SVG to keep the bundle lean and match the existing
// sparkline language.
function TrendsOverTime({ topics }: { topics: string[] }) {
  const [data, setData] = useState<Record<string, WeekSnapshot[]> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (topics.length === 0) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ topics: topics.join(','), weeks: String(CHART_WEEKS) })
    fetch(`/api/snapshots?${params}`)
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`)
        if (!cancelled) setData(json as Record<string, WeekSnapshot[]>)
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [topics])

  return (
    <section className="section" style={{ marginBottom: 0 }}>
      <div className="section-head">
        <h2>Trends Over Time</h2>
        <span className="hint">last {CHART_WEEKS} weeks</span>
      </div>
      {loading && (
        <div className="card" style={{ padding: 'var(--pad)' }}>
          <div className="skel" style={{ height: 14, width: '50%', marginBottom: 8 }} />
          <div className="skel" style={{ height: 80 }} />
        </div>
      )}
      {!loading && error && (
        <div className="card" style={{ padding: '14px 17px', color: 'var(--pain)', fontSize: 13 }}>
          {error}
        </div>
      )}
      {!loading && !error && data && (
        <div
          className="card"
          style={{
            padding: 'var(--pad)',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 'var(--gap)',
          }}
        >
          {topics.map((topic) => (
            <TopicMiniChart key={topic} topic={topic} snapshots={data[topic] ?? []} />
          ))}
        </div>
      )}
    </section>
  )
}

function TopicMiniChart({
  topic,
  snapshots,
}: {
  topic: string
  snapshots: WeekSnapshot[]
}) {
  const hasHistory = snapshots.length >= 2

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '10px 12px',
        borderRadius: 'var(--r-sm)',
        border: '1px solid var(--border-2)',
        background: 'var(--surface)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--ink)',
            flex: 1,
            minWidth: 0,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={topic}
        >
          {topic}
        </span>
        {hasHistory && <DirectionBadge snapshots={snapshots} />}
      </div>
      {hasHistory ? (
        <BarChart snapshots={snapshots} />
      ) : (
        <p style={{ margin: '4px 0 2px', fontSize: 12, color: 'var(--ink-4)', fontStyle: 'italic' }}>
          Collecting data — check back next week.
        </p>
      )}
    </div>
  )
}

function BarChart({ snapshots }: { snapshots: WeekSnapshot[] }) {
  const max = Math.max(...snapshots.map((s) => s.postCount), 1)
  const latest = snapshots[snapshots.length - 1]
  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 3,
          height: 56,
        }}
      >
        {snapshots.map((s, i) => {
          const isLatest = i === snapshots.length - 1
          const h = Math.max(6, (s.postCount / max) * 100)
          return (
            <div
              key={s.weekStart}
              title={`Week of ${s.weekStart}: ${s.postCount} posts`}
              style={{
                flex: 1,
                height: `${h}%`,
                background: isLatest ? 'var(--accent)' : 'var(--accent-soft)',
                borderRadius: '2px 2px 0 0',
                minHeight: 4,
                cursor: 'help',
              }}
            />
          )
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span className="tnum" style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink)' }}>
          {latest.postCount}
        </span>
        <span className="t-xs ink-4">this week</span>
      </div>
    </>
  )
}

function InsightCard({ insight, index }: { insight: Insight; index: number }) {
  return (
    <article
      className="card fade-in"
      style={{ padding: 'var(--pad)', animationDelay: `${index * 60}ms` }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        <span
          className="mono"
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--ink-4)',
            marginTop: 2,
            flexShrink: 0,
          }}
        >
          #{index + 1}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3
            style={{
              fontSize: 16,
              fontWeight: 600,
              letterSpacing: '-0.01em',
              color: 'var(--ink)',
              margin: 0,
              lineHeight: 1.35,
            }}
          >
            {insight.insight}
          </h3>
        </div>
        <span
          className={`badge ${confidenceClass(insight.confidence)}`}
          style={{
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            fontWeight: 600,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            fontSize: 10.5,
            flexShrink: 0,
          }}
        >
          {insight.confidence}
        </span>
      </div>

      {insight.evidence.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--ink-4)',
              marginBottom: 6,
            }}
          >
            Evidence
          </div>
          <ul
            style={{
              margin: 0,
              padding: 0,
              listStyle: 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: 5,
            }}
          >
            {insight.evidence.map((bullet, j) => (
              <li
                key={j}
                style={{
                  fontSize: 12.5,
                  color: 'var(--ink-2)',
                  lineHeight: 1.5,
                  paddingLeft: 14,
                  position: 'relative',
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 8,
                    width: 4,
                    height: 4,
                    borderRadius: 99,
                    background: 'var(--ink-4)',
                  }}
                />
                {bullet}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div
        style={{
          marginTop: 14,
          padding: '12px 14px',
          borderRadius: 'var(--r)',
          background: 'var(--accent-softer)',
          border: '1px solid var(--accent-soft)',
          display: 'flex',
          gap: 9,
          alignItems: 'flex-start',
        }}
      >
        <span style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 2 }}>
          <Icons.bolt size={14} />
        </span>
        <div>
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--accent-text)',
              opacity: 0.75,
              marginBottom: 3,
            }}
          >
            Opportunity
          </div>
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: 'var(--ink)' }}>
            {insight.opportunity}
          </p>
        </div>
      </div>
    </article>
  )
}
