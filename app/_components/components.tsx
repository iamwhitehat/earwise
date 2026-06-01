'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { CATEGORY_CONFIG, CATEGORY_ORDER, type Category } from '@/lib/categories'
import {
  type Stage,
  type SubBucket,
  type TaggedPost,
  type Trend,
  type TrendsTab,
  type Opportunity,
  PER_SUB_CAP,
  COMMENT_SAMPLE_CAP,
  computeOpportunity,
} from '@/lib/scan-types'
import type { CommentQuote } from '@/lib/posts-client'
import type { Direction, WeekSnapshot } from '@/lib/snapshots'
import type { StarterPreset } from '@/lib/use-watchlist'
import { toCsv, downloadCsv } from '@/lib/csv'
import { Icons, Spinner, type SimpleIconProps } from './icons'
import { useScanCtx, useWatchlistCtx } from './scan-provider'
import { useSidebarCtx } from './sidebar-provider'
import { useSubSuggestions } from '@/lib/use-sub-suggestions'

// ─── Topbar (sticky page header with category stats + actions) ───────────────

export function Topbar({
  title,
  crumb,
  posts,
  children,
}: {
  title: string
  crumb?: string
  posts: TaggedPost[]
  children?: ReactNode
}) {
  const { openSidebar } = useSidebarCtx()
  let pain = 0
  let feature = 0
  let tool = 0
  for (const p of posts) {
    if (p.category === 'pain_point') pain++
    else if (p.category === 'feature_request') feature++
    else if (p.category === 'tool_complaint') tool++
  }
  return (
    <div className="topbar">
      <button
        type="button"
        className="topbar-burger"
        onClick={openSidebar}
        aria-label="Open menu"
      >
        <Icons.menu size={18} />
      </button>
      <h1>{title}</h1>
      {crumb && <span className="crumb">{crumb}</span>}
      <div className="topbar-stats">
        <span className="tstat">
          <b className="pain">{pain}</b> <span className="tstat-label">pain</span>
        </span>
        <span className="tstat">
          <b className="feature">{feature}</b> <span className="tstat-label">features</span>
        </span>
        <span className="tstat">
          <b className="tool">{tool}</b> <span className="tstat-label">complaints</span>
        </span>
        {children}
      </div>
    </div>
  )
}

// ─── Score gauge ──────────────────────────────────────────────────────────────

function scoreTier(score: number): 'high' | 'mid' | 'low' {
  if (score >= 7) return 'high'
  if (score >= 4) return 'mid'
  return 'low'
}

export function ScoreGauge({
  score,
  size = 64,
  stroke = 5,
}: {
  score: number
  size?: number
  stroke?: number
}) {
  const tier = scoreTier(score)
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(1, score / 10))
  const [shown, setShown] = useState(0)
  useEffect(() => {
    const t = setTimeout(() => setShown(pct), 80)
    return () => clearTimeout(t)
  }, [pct])
  const fontSize = size >= 60 ? 21 : size >= 44 ? 16 : 13
  return (
    <div className={`gauge score-${tier}`} style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle className="ring-bg" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} />
        <circle
          className="ring-fg"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - shown)}
        />
      </svg>
      <div className="gauge-val" style={{ fontSize }}>
        {score.toFixed(1)}
      </div>
    </div>
  )
}

// ─── Badges & chips ──────────────────────────────────────────────────────────

export function CategoryBadge({
  cat,
  count,
  withDot = true,
}: {
  cat: Category
  count?: number
  withDot?: boolean
}) {
  const cfg = CATEGORY_CONFIG[cat]
  const label = count != null ? `${count} ${cfg.short}${count === 1 ? '' : 's'}` : cfg.short
  return (
    <span className={`badge badge-${cfg.cls}`}>
      {/* Dot is purely a color accent; the badge label below carries the
          actual meaning, so hide the dot from screen readers. */}
      {withDot && <span className="bdot" aria-hidden="true" />}
      {label}
    </span>
  )
}

export function SubChip({ sub }: { sub: string }) {
  return <span className="sub-chip">r/{sub}</span>
}

// ─── Export buttons (CSV copy + download) ────────────────────────────────────

/**
 * Two-button group: copy CSV to clipboard and download it as a file. The
 * caller passes a `build()` thunk that returns headers + rows on demand,
 * so the CSV string is only constructed when the user actually clicks
 * (avoids serialising on every render of a long signal list).
 */
export function ExportButtons({
  filenameStem,
  build,
  disabled,
}: {
  filenameStem: string
  build: () => { headers: readonly string[]; rows: readonly (readonly string[])[] }
  disabled?: boolean
}) {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)

  function buildCsvString() {
    const { headers, rows } = build()
    return toCsv(headers, rows)
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(buildCsvString())
      setCopied(true)
      setCopyError(false)
      setTimeout(() => setCopied(false), 1500)
    } catch (err) {
      console.warn('[export] clipboard write failed:', err)
      setCopyError(true)
      setTimeout(() => setCopyError(false), 2000)
    }
  }

  function handleDownload() {
    const stamp = new Date().toISOString().slice(0, 10)
    downloadCsv(`${filenameStem}-${stamp}.csv`, buildCsvString())
  }

  return (
    <span style={{ display: 'inline-flex', gap: 6 }}>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={handleCopy}
        disabled={disabled}
        title="Copy CSV to clipboard"
      >
        {copyError ? (
          <span style={{ color: 'var(--pain)' }}>Copy failed</span>
        ) : copied ? (
          <span style={{ color: 'var(--score-high)' }}>Copied!</span>
        ) : (
          <>Copy CSV</>
        )}
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={handleDownload}
        disabled={disabled}
        title="Download as .csv file"
      >
        Download
      </button>
    </span>
  )
}

// ─── Errors ──────────────────────────────────────────────────────────────────

export function ErrorsBanner({ errors }: { errors: { sub: string; error: string }[] }) {
  if (errors.length === 0) return null
  return (
    <section
      className="card fade-in"
      style={{
        padding: '14px 17px',
        marginBottom: 'var(--gap)',
        background: 'var(--pain-bg)',
        borderColor: 'oklch(0.9 0.05 22)',
      }}
    >
      <h3 style={{ fontSize: 12, fontWeight: 600, color: 'var(--pain)', margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Couldn&apos;t scan some subreddits
      </h3>
      <ul style={{ fontSize: 13, color: 'var(--ink-2)', margin: 0, padding: 0, listStyle: 'none' }}>
        {errors.map((e) => (
          <li key={e.sub}>
            <span style={{ fontFamily: 'var(--font-geist-mono), monospace' }}>r/{e.sub}</span> — {e.error}
          </li>
        ))}
      </ul>
    </section>
  )
}

// ─── First-run guide (empty dashboard onboarding) ───────────────────────────

export function FirstRunGuide({
  watchlist,
  onScan,
  scanning,
  presets,
  onApplyPreset,
}: {
  watchlist: string[]
  onScan: () => void
  scanning: boolean
  presets: readonly StarterPreset[]
  onApplyPreset: (key: string) => void
}) {
  const hasSubs = watchlist.length > 0
  // Identify which preset (if any) currently matches the watchlist exactly,
  // case-folded — used to disable the "active" preset button so a click
  // doesn't redundantly re-set the same list.
  const lowered = watchlist.map((s) => s.toLowerCase()).sort()
  const activePresetKey = presets.find((p) => {
    const lp = p.subs.map((s) => s.toLowerCase()).sort()
    if (lp.length !== lowered.length) return false
    return lp.every((s, i) => s === lowered[i])
  })?.key

  return (
    <section className="first-run fade-in">
      <header className="first-run-head">
        <span className="first-run-mark" aria-hidden="true">
          <Icons.radar size={22} />
        </span>
        <div>
          <h2>Welcome — three steps to your first signal</h2>
          <p>Once you scan, this card disappears and your dashboard fills in.</p>
        </div>
      </header>

      <ol className="first-run-steps">
        <li>
          <span className="first-run-num">1</span>
          <div className="first-run-body">
            <h3>Track subs that talk about your problem</h3>
            <p>
              {hasSubs
                ? 'We pre-seeded a few founder-heavy subs to get you started — swap to another preset or add more below.'
                : "Your watchlist is empty. Pick a starter preset, ask the AI for niche-specific subs, or add your own."}
            </p>
            <div className="first-run-chips">
              {hasSubs ? (
                watchlist.map((s) => (
                  <span key={s} className="sub-chip">r/{s}</span>
                ))
              ) : (
                <span className="first-run-empty">No subs yet</span>
              )}
              <a className="first-run-link" href="/explore">
                Manage on Explore <Icons.chev size={11} />
              </a>
            </div>
            <div className="first-run-presets">
              <span className="first-run-presets-label">Starter presets:</span>
              {presets.map((p) => {
                const isActive = p.key === activePresetKey
                return (
                  <button
                    key={p.key}
                    type="button"
                    className={`first-run-preset${isActive ? ' active' : ''}`}
                    onClick={() => onApplyPreset(p.key)}
                    disabled={isActive}
                    title={p.description}
                  >
                    {p.label}
                    {isActive && <span className="first-run-preset-active">active</span>}
                  </button>
                )
              })}
            </div>
            <div className="first-run-suggester">
              <SubSuggester />
            </div>
          </div>
        </li>

        <li>
          <span className="first-run-num">2</span>
          <div className="first-run-body">
            <h3>Scan for fresh signals</h3>
            <p>
              Pulls the latest posts, classifies each one (pain / feature / complaint),
              and extracts the topic. Takes ~15s per sub.
            </p>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={onScan}
              disabled={!hasSubs || scanning}
              title={!hasSubs ? 'Add at least one sub first' : undefined}
            >
              {scanning ? (
                <>
                  <Spinner size={12} /> Scanning…
                </>
              ) : (
                <>
                  <Icons.scan size={13} /> Scan now
                </>
              )}
            </button>
          </div>
        </li>

        <li>
          <span className="first-run-num">3</span>
          <div className="first-run-body">
            <h3>Review opportunities &amp; buying intent</h3>
            <p>
              Top topics surface here. <a href="/insights">Insights</a> ranks
              them with AI commentary; <a href="/signals">Signals</a> filters
              for high-intent posts ready to engage.
            </p>
          </div>
        </li>
      </ol>
    </section>
  )
}

// ─── Opportunity card (Top Opportunities) ────────────────────────────────────

export type InsightState = {
  status: 'loading' | 'ready' | 'error'
  insight?: string
  error?: string
}

export function OpportunityCard({
  opp,
  rank,
  selected,
  onSelect,
  insight,
  snapshots,
}: {
  opp: Opportunity
  rank?: number
  selected: boolean
  onSelect: () => void
  insight?: InsightState
  /** Last N weeks of snapshots for this topic, chronological. Drives the direction badge. */
  snapshots?: WeekSnapshot[]
}) {
  return (
    <button
      type="button"
      className={`opp-card fade-in${selected ? ' selected' : ''}`}
      onClick={onSelect}
      aria-pressed={selected}
      style={rank != null ? { animationDelay: `${rank * 50}ms` } : undefined}
    >
      {rank != null && <span className="opp-rank mono">#{rank + 1}</span>}
      <div className="opp-top">
        <div className="opp-meta">
          <h3 className="opp-title">{opp.topic}</h3>
          <div className="opp-foot">
            <CategoryBadge cat="pain_point" count={opp.painCount} />
            {opp.featureCount > 0 && <CategoryBadge cat="feature_request" count={opp.featureCount} />}
            {opp.toolCount > 0 && <CategoryBadge cat="tool_complaint" count={opp.toolCount} />}
            {snapshots && <DirectionBadge snapshots={snapshots} />}
          </div>
          <div className="opp-subs">
            {opp.subreddits.map((s) => (
              <SubChip key={s} sub={s} />
            ))}
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <ScoreGauge score={opp.scoreRaw} size={66} />
          <div className="gauge-cap">Opportunity</div>
        </div>
      </div>
      <InsightLine
        insight={insight?.status === 'ready' ? insight.insight! : null}
        loading={!insight || insight.status === 'loading'}
        error={insight?.status === 'error' ? insight.error! : null}
      />
    </button>
  )
}

// Trend direction badge — surfaces rising/declining/accelerating/etc. on
// opportunity cards. `title` attribute carries the per-week numbers so a
// hover gives the actual trajectory ("Week 1: 8 → Week 2: 15 → Week 3: 23").
function directionStyle(dir: Direction): { label: string; bg: string; color: string } {
  switch (dir) {
    case 'accelerating':
      return { label: '🚀 Accelerating', bg: 'oklch(0.95 0.08 145)', color: 'oklch(0.45 0.18 145)' }
    case 'rising':
      return { label: '↑ Rising', bg: 'oklch(0.95 0.05 158)', color: 'var(--score-high)' }
    case 'declining':
      return { label: '↓ Declining', bg: 'var(--pain-bg)', color: 'var(--pain)' }
    case 'stable':
      return { label: '→ Stable', bg: 'var(--surface-2)', color: 'var(--ink-3)' }
    case 'new':
      return { label: 'New', bg: 'var(--accent-soft)', color: 'var(--accent-text)' }
  }
}

export function DirectionBadge({
  snapshots,
}: {
  snapshots: WeekSnapshot[]
}) {
  if (snapshots.length === 0) return null
  const counts = snapshots.map((s) => s.postCount)
  // Lazy-import would be cleaner but this file is client-only; the helper is
  // pure JS so no harm.
  const dir = computeDirectionInline(counts)
  const style = directionStyle(dir)
  const tooltip =
    snapshots.length === 1
      ? `1 week of history: ${counts[0]} posts`
      : snapshots.map((s, i) => `Week ${i + 1}: ${s.postCount}`).join(' → ')
  return (
    <span
      title={tooltip}
      className="badge"
      style={{
        background: style.bg,
        color: style.color,
        fontWeight: 600,
        cursor: 'help',
      }}
    >
      {style.label}
    </span>
  )
}

// Inlined to avoid a circular import via lib/snapshots → claude prompts etc.
// Same algorithm as lib/snapshots#computeDirection.
function computeDirectionInline(counts: number[]): Direction {
  const n = counts.length
  if (n < 2) return 'new'
  const cur = counts[n - 1]
  const prev = counts[n - 2]
  if (n >= 3) {
    const prev2 = counts[n - 3]
    const delta1 = prev - prev2
    const delta2 = cur - prev
    if (delta2 > delta1 && delta2 > 0) return 'accelerating'
  }
  const pct = prev > 0 ? (cur - prev) / prev : cur > 0 ? 1 : 0
  if (pct > 0.2) return 'rising'
  if (pct < -0.2) return 'declining'
  return 'stable'
}

function InsightLine({
  insight,
  loading,
  error,
}: {
  insight: string | null
  loading: boolean
  error: string | null
}) {
  return (
    <div className="opp-insight">
      <span className="spark">
        <Icons.bolt size={14} />
      </span>
      <span>
        {loading && <span style={{ display: 'inline-block', width: '70%', height: '0.95em', borderRadius: 4, background: 'var(--border-2)', verticalAlign: 'middle' }} className="skel" />}
        {!loading && error && <span style={{ color: 'var(--pain)' }}>Insight unavailable — {error}</span>}
        {!loading && !error && insight}
      </span>
    </div>
  )
}

function formatAgo(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`
  return `${Math.floor(diff / 86_400_000)}d`
}

// ─── Trend row (Explore list) ────────────────────────────────────────────────

export function TrendRow({
  opp,
  spark,
  selected,
  onSelect,
}: {
  opp: Opportunity
  spark: number[]
  selected: boolean
  onSelect: () => void
}) {
  const tier = scoreTier(opp.scoreRaw)
  const cats = [
    opp.painCount > 0 && 'pain',
    opp.featureCount > 0 && 'feature',
    opp.toolCount > 0 && 'tool',
  ].filter(Boolean) as string[]
  const max = Math.max(...spark, 1)
  return (
    <button
      type="button"
      className={`trend-row${selected ? ' selected' : ''}`}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <span className={`trend-score score-${tier}`}>{opp.scoreRaw.toFixed(1)}</span>
      <div
        className="trend-spark"
        role="img"
        aria-label={`8-week trend: ${spark.join(', ')} posts per week`}
      >
        {spark.map((v, i) => (
          <i
            key={i}
            title={
              i === spark.length - 1
                ? `this week: ${v} posts`
                : `${spark.length - 1 - i} week${spark.length - 1 - i === 1 ? '' : 's'} ago: ${v} posts`
            }
            style={{
              height: `${Math.max(10, (v / max) * 100)}%`,
              background: i === spark.length - 1 ? 'var(--accent)' : 'var(--border)',
            }}
          />
        ))}
      </div>
      <div className="trend-mid">
        <div className="trend-name">{opp.topic}</div>
        <div className="trend-sub">
          <span className="tnum">{opp.total} posts</span>
          <span>·</span>
          <span>{opp.subreddits.map((s) => `r/${s}`).join(', ')}</span>
        </div>
      </div>
      <div className="trend-cats">
        {cats.map((c) => {
          const long = c === 'pain' ? 'pain points' : c === 'feature' ? 'feature requests' : 'tool complaints'
          const letter = c === 'pain' ? 'P' : c === 'feature' ? 'F' : 'T'
          return (
            <span
              key={c}
              className={`cat-tick cat-tick-${c}`}
              title={long}
              aria-label={long}
            >
              {letter}
            </span>
          )
        })}
      </div>
      <span className="trend-chev">
        <Icons.chev />
      </span>
    </button>
  )
}

// ─── Per-sub progress UI ─────────────────────────────────────────────────────

function stageDisplay(stage: Stage): {
  text: string
  pct: number
  variant: 'normal' | 'done' | 'stopped' | 'failed'
  indeterminate: boolean
  pulse: boolean
} {
  switch (stage.kind) {
    case 'fetching':
      return { text: 'fetching', pct: 0, variant: 'normal', indeterminate: true, pulse: false }
    case 'sizing':
      return {
        text: `${stage.newCount} new · ${stage.cachedCount} cached`,
        pct: 5,
        variant: 'normal',
        indeterminate: false,
        pulse: true,
      }
    case 'classifying':
      return {
        text: `classifying ${stage.current}/${stage.total}`,
        pct: stage.total > 0 ? Math.round((stage.current / stage.total) * 100) : 0,
        variant: 'normal',
        indeterminate: false,
        pulse: true,
      }
    case 'extracting':
      return {
        text: `extracting topics ${stage.current}/${stage.total}`,
        pct: stage.total > 0 ? Math.round((stage.current / stage.total) * 100) : 0,
        variant: 'normal',
        indeterminate: false,
        pulse: true,
      }
    case 'done':
      return {
        text: stage.allCached
          ? `done · ${stage.totalCount} cached`
          : `done · ${stage.analyzedCount} classified`,
        pct: 100,
        variant: 'done',
        indeterminate: false,
        pulse: false,
      }
    case 'stopped':
      return {
        text: `stopped · ${stage.analyzedCount}/${stage.totalCount} classified`,
        pct: stage.totalCount > 0 ? Math.round((stage.analyzedCount / stage.totalCount) * 100) : 0,
        variant: 'stopped',
        indeterminate: false,
        pulse: false,
      }
    case 'failed':
      return { text: stage.error, pct: 100, variant: 'failed', indeterminate: false, pulse: false }
  }
}

function ProgressBar({
  pct,
  variant,
  indeterminate,
  pulse,
}: {
  pct: number
  variant: 'normal' | 'done' | 'stopped' | 'failed'
  indeterminate: boolean
  pulse: boolean
}) {
  if (indeterminate) {
    return (
      <div className="pbar indet">
        <i className="pulse" />
      </div>
    )
  }
  const cls = [
    variant === 'done' && 'done',
    variant === 'stopped' && 'stopped',
    variant === 'failed' && 'failed',
    pulse && 'pulse',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <div className="pbar">
      <i className={cls} style={{ width: `${pct}%` }} />
    </div>
  )
}

// Inline scan banner — used at the top of Dashboard and Explore while
// scanning. Compact, dense, with per-sub bars.
export function ScanBanner({
  buckets,
  order,
}: {
  buckets: Record<string, SubBucket>
  order: string[]
}) {
  const entries = order.map((sub) => buckets[sub]).filter((b): b is SubBucket => Boolean(b))
  const activeEntries = entries.filter((b) => b.stage)
  if (activeEntries.length === 0) return null
  const doneCount = activeEntries.filter((b) => b.stage?.kind === 'done').length
  return (
    <div className="card fade-in" style={{ marginBottom: 'var(--gap)', overflow: 'hidden' }}>
      <div
        style={{
          padding: '13px 16px',
          borderBottom: '1px solid var(--border-2)',
          display: 'flex',
          alignItems: 'center',
          gap: 9,
        }}
      >
        <Spinner color="var(--accent)" />
        <span style={{ fontSize: 13, fontWeight: 600 }}>Scanning watchlist…</span>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-3)' }} className="tnum">
          {doneCount}/{activeEntries.length} done
        </span>
      </div>
      {activeEntries.map((b) => {
        const stage = b.stage!
        const d = stageDisplay(stage)
        return (
          <div className="scan-sub" key={b.sub}>
            <div className="scan-sub-head">
              <span className="scan-sub-name">r/{b.sub}</span>
              <span className="scan-stage">{d.text}</span>
            </div>
            <ProgressBar pct={d.pct} variant={d.variant} indeterminate={d.indeterminate} pulse={d.pulse} />
          </div>
        )
      })}
    </div>
  )
}

// Per-sub list used on Explore — shows ALL watchlist buckets (with or without
// active scan), plus the Load More control.
export function ScannedSubreddits({
  buckets,
  order,
  onLoadMore,
}: {
  buckets: Record<string, SubBucket>
  order: string[]
  onLoadMore: (sub: string) => void
}) {
  const entries = order.map((sub) => buckets[sub]).filter((b): b is SubBucket => Boolean(b))
  if (entries.length === 0) return null
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      {entries.map((b) => {
        const atCap = b.posts.length >= PER_SUB_CAP
        const endOfFeed = b.nextAfter === null
        const d = b.stage ? stageDisplay(b.stage) : null
        return (
          <div className="scan-sub" key={b.sub}>
            <div className="scan-sub-head">
              <span className="scan-sub-name">r/{b.sub}</span>
              <span className="scan-stage">{d?.text ?? ''}</span>
              <span className="scan-count">
                {b.loadMoreError && !b.stage && (
                  <span style={{ color: 'var(--pain)' }}>{b.loadMoreError} · </span>
                )}
                {b.posts.length} / {PER_SUB_CAP}
                {!b.stage && (
                  <>
                    {atCap ? (
                      <span style={{ marginLeft: 8 }}>limit reached</span>
                    ) : endOfFeed ? (
                      <span style={{ marginLeft: 8 }}>
                        {b.posts.length > 0 ? 'scan for more' : 'end of feed'}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => onLoadMore(b.sub)}
                        disabled={b.loadingMore}
                        style={{ marginLeft: 8 }}
                      >
                        Load more
                      </button>
                    )}
                  </>
                )}
              </span>
            </div>
            {d && (
              <ProgressBar pct={d.pct} variant={d.variant} indeterminate={d.indeterminate} pulse={d.pulse} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Watchlist editor (Explore) ──────────────────────────────────────────────

export function WatchlistEditor({
  watchlist,
  hydrated,
  onAdd,
  onRemove,
  onScan,
  onStop,
  scanning,
  postsPerScan,
  postsPerScanOptions,
  onChangePostsPerScan,
}: {
  watchlist: string[]
  hydrated: boolean
  onAdd: (rawInput: string) => string | null
  onRemove: (sub: string) => void
  onScan: () => void
  onStop: () => void
  scanning: boolean
  postsPerScan: number
  postsPerScanOptions: readonly number[]
  onChangePostsPerScan: (n: number) => void
}) {
  const [input, setInput] = useState('')
  const [err, setErr] = useState<string | null>(null)

  function handleAdd() {
    const next = onAdd(input)
    if (next) {
      setErr(next)
    } else {
      setInput('')
      setErr(null)
    }
  }

  return (
    <div className="card" style={{ padding: 'var(--pad)', marginBottom: 'var(--gap)' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 13 }}>
        <h2 className="section-head" style={{ margin: 0, padding: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
            Watchlist
          </span>
        </h2>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-4)' }} className="tnum">
          {watchlist.length} subreddit{watchlist.length === 1 ? '' : 's'}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 9, marginBottom: 12, flexWrap: 'wrap' }}>
        <div className="watch-input">
          <span className="pre">r/</span>
          <input
            type="text"
            value={input}
            placeholder="add a subreddit…"
            disabled={scanning}
            onChange={(e) => {
              setInput(e.target.value)
              if (err) setErr(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleAdd()
              }
            }}
          />
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={handleAdd}
          disabled={scanning || input.trim() === ''}
        >
          <Icons.plus size={15} /> Add
        </button>
        <PostsPerScanSelector
          value={postsPerScan}
          onChange={onChangePostsPerScan}
          disabled={scanning}
          options={postsPerScanOptions}
        />
        {scanning ? (
          <button type="button" className="btn btn-danger" onClick={onStop}>
            <Icons.stop size={15} /> Stop Scan
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            onClick={onScan}
            disabled={watchlist.length === 0}
          >
            <Icons.scan size={15} /> Scan all
          </button>
        )}
      </div>
      {err && (
        <p style={{ fontSize: 12, color: 'var(--pain)', margin: '0 0 10px' }}>{err}</p>
      )}
      <div className="watch-tags">
        {hydrated &&
          watchlist.map((sub) => (
            <span className="watch-tag" key={sub}>
              r/{sub}
              <button
                type="button"
                onClick={() => onRemove(sub)}
                disabled={scanning}
                aria-label={`Remove r/${sub}`}
              >
                <Icons.x size={11} />
              </button>
            </span>
          ))}
        {hydrated && watchlist.length === 0 && (
          <span className="t-md ink-4">No subs yet.</span>
        )}
      </div>
    </div>
  )
}

// ─── Comment coverage stat (compact line for Dashboard) ─────────────────────

export type CommentStats = {
  postsScanned: number
  commentsAnalyzed: number
  byCategory: Record<Category, number>
}

export function CommentCoverage({ stats }: { stats: CommentStats | null }) {
  if (!stats) return null
  const total = stats.byCategory.pain_point + stats.byCategory.feature_request + stats.byCategory.tool_complaint + stats.byCategory.other
  return (
    <div
      style={{
        display: 'flex',
        gap: 12,
        alignItems: 'center',
        flexWrap: 'wrap',
        padding: '10px 14px',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r)',
        background: 'var(--surface)',
        fontSize: 12.5,
        color: 'var(--ink-2)',
      }}
    >
      <span>
        <strong className="tnum" style={{ color: 'var(--ink)' }}>
          {stats.postsScanned}
        </strong>{' '}
        posts deep-scanned
      </span>
      <span style={{ color: 'var(--ink-4)' }}>·</span>
      <span>
        <strong className="tnum" style={{ color: 'var(--ink)' }}>
          {stats.commentsAnalyzed}
        </strong>{' '}
        comments analyzed
      </span>
      {total > 0 && (
        <>
          <span style={{ color: 'var(--ink-4)', marginLeft: 4 }}>·</span>
          {stats.byCategory.pain_point > 0 && (
            <span className="badge badge-pain">
              <span className="bdot" />
              {stats.byCategory.pain_point} pain
            </span>
          )}
          {stats.byCategory.feature_request > 0 && (
            <span className="badge badge-feature">
              <span className="bdot" />
              {stats.byCategory.feature_request} features
            </span>
          )}
          {stats.byCategory.tool_complaint > 0 && (
            <span className="badge badge-tool">
              <span className="bdot" />
              {stats.byCategory.tool_complaint} complaints
            </span>
          )}
        </>
      )}
    </div>
  )
}

// ─── Buyer Language compact summary (Dashboard) ─────────────────────────────

/**
 * Read-only summary for the Dashboard — top N chips per column with a "View
 * all" link to /language. No filters, no refresh, no click-to-expand; the
 * full interactive experience lives on /language.
 */
export function BuyerLanguageSummary({
  data,
  loading,
  error,
  limit = 6,
}: {
  data: BuyerLanguageData | null
  loading: boolean
  error: string | null
  limit?: number
}) {
  return (
    <section className="section">
      <div className="section-head">
        <h2>Buyer Language</h2>
        <span className="hint">
          {data
            ? `top ${limit} per column · from ${data.stats.postCount} posts · ${data.stats.commentCount} comments`
            : 'recurring phrases · tools · emotional words'}
        </span>
        <a
          href="/language"
          className="btn btn-ghost btn-sm"
          style={{ marginLeft: 8, textDecoration: 'none' }}
        >
          View all <Icons.chev size={12} />
        </a>
      </div>
      {loading && !data && (
        <div className="card" style={{ padding: 'var(--pad)' }}>
          <div className="skel" style={{ height: 14, width: '40%', marginBottom: 10 }} />
          <div className="skel" style={{ height: 40 }} />
        </div>
      )}
      {error && !data && (
        <div className="card" style={{ padding: '14px 17px', color: 'var(--pain)', fontSize: 13 }}>
          {error}
        </div>
      )}
      {!loading && !data && !error && (
        <div className="card empty">
          <span className="e-ico"><Icons.sparkles size={26} /></span>
          <div>
            No buyer-language data yet.{' '}
            <a href="/language" style={{ color: 'var(--accent-text)', fontWeight: 550 }}>
              Generate on /language →
            </a>
          </div>
        </div>
      )}
      {data && (
        <div
          className="card"
          style={{
            padding: 'var(--pad)',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 'var(--gap)',
          }}
        >
          <ReadOnlyChipColumn label="Common phrases" items={data.phrases.slice(0, limit)} />
          <ReadOnlyChipColumn label="Tools mentioned" items={data.tools.slice(0, limit)} mono />
          <ReadOnlyChipColumn label="Emotional language" items={data.emotional.slice(0, limit)} />
        </div>
      )}
    </section>
  )
}

function ReadOnlyChipColumn({
  label,
  items,
  mono = false,
}: {
  label: string
  items: LangItem[]
  mono?: boolean
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--ink-4)',
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      {items.length === 0 ? (
        <p className="t-mdp ink-4 m-0">—</p>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {items.map((item) => (
            <span
              key={item.text}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                border: '1px solid var(--border)',
                background: 'var(--surface-2)',
                color: 'var(--ink-2)',
                padding: '3px 9px',
                borderRadius: 99,
                fontSize: 12,
                fontFamily: mono ? 'var(--font-geist-mono), monospace' : 'inherit',
              }}
            >
              <span>{item.text}</span>
              {item.count > 1 && (
                <span
                  className="tnum"
                  style={{ color: 'var(--ink-4)', fontSize: 10.5, fontWeight: 600 }}
                >
                  {item.count}
                </span>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/** Filter helpers exported for the /language page. */
export function filterLangItems(
  items: LangItem[],
  subFilter: string,
  catFilter: string,
): LangItem[] {
  if (subFilter === 'all' && catFilter === 'all') return items
  const out: LangItem[] = []
  for (const item of items) {
    if (!item.contexts || item.contexts.length === 0) {
      // Old rows without enrichment: include but show original count. We
      // can't actually filter these, so they pass through.
      out.push(item)
      continue
    }
    const matching = item.contexts.filter((c) => {
      const subOk = subFilter === 'all' || c.subreddit === subFilter
      const catOk = catFilter === 'all' || c.category === catFilter
      return subOk && catOk
    })
    if (matching.length === 0) continue
    out.push({ ...item, contexts: matching, count: matching.length })
  }
  return out
}

export function collectSubreddits(data: BuyerLanguageData): string[] {
  const subs = new Set<string>()
  for (const list of [data.phrases, data.tools, data.emotional]) {
    for (const item of list) {
      for (const c of item.contexts ?? []) {
        if (c.subreddit) subs.add(c.subreddit)
      }
    }
  }
  return Array.from(subs).sort()
}

// ─── Buyer Language panel ────────────────────────────────────────────────────

export type LangContext = {
  quote: string
  post_id: string
  // Present on rows generated after migration 2b-octies + the filter update.
  // Old rows omit them and the /language filters silently no-op for those.
  subreddit?: string
  category?: Category
}

export type LangItem = {
  text: string
  count: number
  contexts?: LangContext[]
}

export type BuyerLanguageData = {
  phrases: LangItem[]
  tools: LangItem[]
  emotional: LangItem[]
  stats: { postCount: number; commentCount: number }
  generatedAt: number
}

type ChipKind = 'phrase' | 'tool' | 'emotional'

type SearchMatch = {
  kind: 'post' | 'comment'
  post_id: string
  subreddit: string
  permalink: string
  snippet: string
  title?: string | null
  author?: string | null
}

export function BuyerLanguagePanel({
  data,
  loading,
  error,
  refreshing,
  onRefresh,
  layout = 'grid',
  showHeader = true,
  renderCopyButtons = false,
}: {
  data: BuyerLanguageData | null
  loading: boolean
  error: string | null
  refreshing: boolean
  onRefresh: () => void
  /** 'grid' = 3 columns (Dashboard). 'stacked' = vertical full-width sections (/language). */
  layout?: 'grid' | 'stacked'
  /** Hide the section header — useful when the parent renders its own. */
  showHeader?: boolean
  /** Show a per-section "Copy all" button. */
  renderCopyButtons?: boolean
}) {
  const [selected, setSelected] = useState<{ kind: ChipKind; text: string } | null>(null)
  const [matches, setMatches] = useState<SearchMatch[] | null>(null)
  const [matchesLoading, setMatchesLoading] = useState(false)
  const [matchesError, setMatchesError] = useState<string | null>(null)

  useEffect(() => {
    if (!selected) {
      setMatches(null)
      setMatchesError(null)
      return
    }
    let cancelled = false
    setMatchesLoading(true)
    setMatchesError(null)
    setMatches(null)
    const params = new URLSearchParams({ term: selected.text, kind: selected.kind })
    fetch(`/api/buyer-language/search?${params}`)
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`)
        if (!cancelled) setMatches((json as { matches: SearchMatch[] }).matches)
      })
      .catch((err: Error) => {
        if (!cancelled) setMatchesError(err.message)
      })
      .finally(() => {
        if (!cancelled) setMatchesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selected])

  function toggle(kind: ChipKind, text: string) {
    setSelected((prev) => (prev && prev.kind === kind && prev.text === text ? null : { kind, text }))
  }

  const stacked = layout === 'stacked'
  return (
    <section className="section">
      {showHeader && (
        <div className="section-head">
          <h2>Buyer Language</h2>
          <span className="pill">phrases · tools · emotional words</span>
          <span className="hint">
            {data
              ? `from ${data.stats.postCount} posts · ${data.stats.commentCount} comments`
              : 'extracted from your posts + deep-scanned comments'}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onRefresh}
            disabled={refreshing}
            style={{ marginLeft: 8 }}
          >
            {refreshing ? (
              <>
                <Spinner size={11} color="var(--ink-3)" /> Refreshing…
              </>
            ) : (
              <>
                <Icons.sparkles size={12} /> Refresh language
              </>
            )}
          </button>
        </div>
      )}

      {loading && !data && (
        <div className="card" style={{ padding: 'var(--pad)' }}>
          <div className="skel" style={{ height: 14, width: '40%', marginBottom: 10 }} />
          <div className="skel" style={{ height: 60 }} />
        </div>
      )}

      {error && !data && (
        <div className="card" style={{ padding: '14px 17px', color: 'var(--pain)', fontSize: 13 }}>
          {error}
        </div>
      )}

      {!loading && !data && !error && (
        <div className="card empty">
          <span className="e-ico">
            <Icons.sparkles size={26} />
          </span>
          <div>
            No buyer-language data yet. Click <strong>Refresh language</strong> to extract
            the recurring phrases, tools, and emotional words from your scanned data.
          </div>
        </div>
      )}

      {data && stacked && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap)' }}>
          <StackedChipSection
            label="Common phrases"
            kind="phrase"
            items={data.phrases}
            selected={selected}
            onToggle={toggle}
            emptyText="No recurring phrases extracted."
            renderCopy={renderCopyButtons}
          />
          <StackedChipSection
            label="Tools mentioned"
            kind="tool"
            items={data.tools}
            selected={selected}
            onToggle={toggle}
            emptyText="No tools mentioned — try deep-scanning more posts."
            renderCopy={renderCopyButtons}
            mono
          />
          <StackedChipSection
            label="Emotional language"
            kind="emotional"
            items={data.emotional}
            selected={selected}
            onToggle={toggle}
            emptyText="No emotional words extracted."
            renderCopy={renderCopyButtons}
          />
        </div>
      )}

      {data && !stacked && (
        <div
          className="card"
          style={{
            padding: 'var(--pad)',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 'var(--gap)',
          }}
        >
          <ChipCloud
            label="Common phrases"
            kind="phrase"
            items={data.phrases}
            selected={selected}
            onToggle={toggle}
            emptyText="No recurring phrases extracted."
          />
          <ChipCloud
            label="Tools mentioned"
            kind="tool"
            items={data.tools}
            selected={selected}
            onToggle={toggle}
            emptyText="No tools mentioned — try deep-scanning more posts."
          />
          <ChipCloud
            label="Emotional language"
            kind="emotional"
            items={data.emotional}
            selected={selected}
            onToggle={toggle}
            emptyText="No emotional words extracted."
          />
        </div>
      )}

      {selected && (
        <BuyerLanguageMatches
          term={selected.text}
          kind={selected.kind}
          loading={matchesLoading}
          error={matchesError}
          matches={matches}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  )
}

function ChipCloud({
  label,
  kind,
  items,
  selected,
  onToggle,
  emptyText,
}: {
  label: string
  kind: ChipKind
  items: LangItem[]
  selected: { kind: ChipKind; text: string } | null
  onToggle: (kind: ChipKind, text: string) => void
  emptyText: string
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--ink-4)',
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      {items.length === 0 ? (
        <p className="t-mdp ink-4 m-0">{emptyText}</p>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {items.map((item) => {
            const isSelected = selected?.kind === kind && selected.text === item.text
            return (
              <button
                key={item.text}
                type="button"
                onClick={() => onToggle(kind, item.text)}
                title={`Click to see where "${item.text}" appears`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  border: '1px solid',
                  borderColor: isSelected ? 'var(--accent-ring)' : 'var(--border)',
                  background: isSelected ? 'var(--accent-soft)' : 'var(--surface-2)',
                  color: isSelected ? 'var(--accent-text)' : 'var(--ink-2)',
                  padding: '3px 9px',
                  borderRadius: 99,
                  fontSize: 12,
                  fontFamily:
                    kind === 'tool' ? 'var(--font-geist-mono), monospace' : 'inherit',
                  cursor: 'pointer',
                  transition: 'all .12s',
                }}
              >
                <span>{item.text}</span>
                {item.count > 1 && (
                  <span
                    className="tnum"
                    style={{ color: 'var(--ink-4)', fontSize: 10.5, fontWeight: 600 }}
                  >
                    {item.count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Stacked, full-width section with a header (label + count + Copy all) and a
// chip cloud below. Used on /language; the existing ChipCloud is the
// compact grid variant used on Dashboard's full panel.
function StackedChipSection({
  label,
  kind,
  items,
  selected,
  onToggle,
  emptyText,
  renderCopy,
  mono = false,
}: {
  label: string
  kind: ChipKind
  items: LangItem[]
  selected: { kind: ChipKind; text: string } | null
  onToggle: (kind: ChipKind, text: string) => void
  emptyText: string
  renderCopy: boolean
  mono?: boolean
}) {
  return (
    <div className="card" style={{ padding: 'var(--pad)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 10,
          marginBottom: 12,
          flexWrap: 'wrap',
        }}
      >
        <h3
          style={{
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            color: 'var(--ink-3)',
            margin: 0,
          }}
        >
          {label}
        </h3>
        <span className="tnum t-md ink-4">
          {items.length} item{items.length === 1 ? '' : 's'}
        </span>
        {renderCopy && items.length > 0 && (
          <CopyAllButton items={items} style={{ marginLeft: 'auto' }} />
        )}
      </div>
      {items.length === 0 ? (
        <p className="t-mdp ink-4 m-0">{emptyText}</p>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {items.map((item) => {
            const isSelected = selected?.kind === kind && selected.text === item.text
            return (
              <button
                key={item.text}
                type="button"
                onClick={() => onToggle(kind, item.text)}
                title={`Click to see where "${item.text}" appears`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  border: '1px solid',
                  borderColor: isSelected ? 'var(--accent-ring)' : 'var(--border)',
                  background: isSelected ? 'var(--accent-soft)' : 'var(--surface-2)',
                  color: isSelected ? 'var(--accent-text)' : 'var(--ink-2)',
                  padding: '4px 11px',
                  borderRadius: 99,
                  fontSize: 12.5,
                  fontFamily: mono ? 'var(--font-geist-mono), monospace' : 'inherit',
                  cursor: 'pointer',
                  transition: 'all .12s',
                }}
              >
                <span>{item.text}</span>
                {item.count > 1 && (
                  <span
                    className="tnum"
                    style={{ color: 'var(--ink-4)', fontSize: 10.5, fontWeight: 600 }}
                  >
                    {item.count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function CopyAllButton({
  items,
  style,
}: {
  items: LangItem[]
  style?: React.CSSProperties
}) {
  const [copied, setCopied] = useState(false)
  async function handleCopy() {
    const text = items.map((it) => (it.count > 1 ? `${it.text} (${it.count})` : it.text)).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (err) {
      console.warn('[copy] clipboard write failed:', err)
    }
  }
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={handleCopy}
      style={style}
    >
      {copied ? (
        <span style={{ color: 'var(--score-high)' }}>Copied!</span>
      ) : (
        <>Copy all</>
      )}
    </button>
  )
}

function BuyerLanguageMatches({
  term,
  kind,
  loading,
  error,
  matches,
  onClose,
}: {
  term: string
  kind: ChipKind
  loading: boolean
  error: string | null
  matches: SearchMatch[] | null
  onClose: () => void
}) {
  return (
    <div
      className="card fade-in"
      style={{ padding: 'var(--pad)', marginTop: 'var(--gap)' }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
        <h3
          style={{
            fontSize: 13,
            fontWeight: 600,
            margin: 0,
            color: 'var(--ink)',
          }}
        >
          Where{' '}
          <span
            style={{
              color: 'var(--accent-text)',
              fontFamily: kind === 'tool' ? 'var(--font-geist-mono), monospace' : 'inherit',
            }}
          >
            &ldquo;{term}&rdquo;
          </span>{' '}
          appears
        </h3>
        {matches && (
          <span className="t-md ink-4">
            · {matches.length} match{matches.length === 1 ? '' : 'es'}
          </span>
        )}
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onClose}
          style={{ marginLeft: 'auto' }}
        >
          <Icons.x size={12} /> Close
        </button>
      </div>
      {loading && (
        <div style={{ padding: '4px 0' }}>
          <div className="skel" style={{ height: 14, marginBottom: 6 }} />
          <div className="skel" style={{ height: 14, width: '70%' }} />
        </div>
      )}
      {!loading && error && (
        <p style={{ color: 'var(--pain)', fontSize: 12.5, margin: 0 }}>{error}</p>
      )}
      {!loading && !error && matches && matches.length === 0 && (
        <p className="t-mdp ink-4 m-0">
          No matches found in posts or comments. The phrase may have come from a
          truncated snippet in the Claude extraction.
        </p>
      )}
      {!loading && !error && matches && matches.length > 0 && (
        <ul
          style={{
            margin: 0,
            padding: 0,
            listStyle: 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {matches.map((m, i) => (
            <li
              key={`${m.post_id}:${m.kind}:${i}`}
              style={{
                padding: '8px 10px',
                borderRadius: 'var(--r-sm)',
                background: 'var(--surface-2)',
                border: '1px solid var(--border-2)',
                display: 'flex',
                gap: 10,
                alignItems: 'flex-start',
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  padding: '1px 6px',
                  borderRadius: 99,
                  background: m.kind === 'post' ? 'var(--accent-soft)' : 'var(--surface)',
                  color: m.kind === 'post' ? 'var(--accent-text)' : 'var(--ink-3)',
                  border: '1px solid var(--border)',
                  flexShrink: 0,
                }}
              >
                {m.kind}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                {m.title && (
                  <div
                    style={{
                      fontSize: 12.5,
                      color: 'var(--ink)',
                      fontWeight: 500,
                      marginBottom: 3,
                    }}
                  >
                    {m.title}
                  </div>
                )}
                <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.45 }}>
                  {m.snippet}
                </div>
                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                    marginTop: 4,
                    fontSize: 11,
                    color: 'var(--ink-4)',
                  }}
                >
                  <SubChip sub={m.subreddit} />
                  {m.author && <span>u/{m.author}</span>}
                </div>
              </div>
              <a
                href={m.permalink}
                target="_blank"
                rel="noopener noreferrer"
                className="ext"
                title="View on Reddit"
                aria-label="View on Reddit"
              >
                <Icons.ext />
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ─── AI subreddit suggestions ────────────────────────────────────────────────

export function SubSuggester() {
  const { watchlist, addSubreddit } = useWatchlistCtx()
  const { suggest, suggestions, loading, error, fromCache, lastNiche } = useSubSuggestions()
  const [input, setInput] = useState('')

  function handleSuggest() {
    if (loading) return
    suggest(input)
  }

  const watchlistSet = new Set(watchlist)

  return (
    <div className="card" style={{ padding: 'var(--pad)', marginBottom: 'var(--gap)' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 13 }}>
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            color: 'var(--ink-3)',
          }}
        >
          Suggest subreddits
        </span>
        <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--ink-4)' }}>
          AI · powered by Claude
        </span>
      </div>
      <div style={{ display: 'flex', gap: 9, marginBottom: 10, flexWrap: 'wrap' }}>
        <div className="watch-input">
          <input
            type="text"
            value={input}
            placeholder="your niche — e.g. B2B SaaS, e-commerce, devtools…"
            disabled={loading}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleSuggest()
              }
            }}
          />
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleSuggest}
          disabled={loading || input.trim().length < 2}
        >
          {loading ? (
            <>
              <Spinner size={13} /> Thinking…
            </>
          ) : (
            <>
              <Icons.sparkles size={15} /> Suggest
            </>
          )}
        </button>
      </div>
      {error && <p style={{ fontSize: 12, color: 'var(--pain)', margin: '0 0 10px' }}>{error}</p>}
      {suggestions !== null && (
        <div>
          <div
            style={{
              fontSize: 11.5,
              color: 'var(--ink-4)',
              marginBottom: 8,
              display: 'flex',
              alignItems: 'baseline',
              gap: 6,
            }}
          >
            <span>
              {suggestions.length} suggestion{suggestions.length === 1 ? '' : 's'} for{' '}
              <span style={{ color: 'var(--ink-2)', fontWeight: 500 }}>
                &ldquo;{lastNiche}&rdquo;
              </span>
            </span>
            {fromCache && (
              <span
                style={{
                  fontSize: 10,
                  color: 'var(--accent-text)',
                  background: 'var(--accent-soft)',
                  padding: '1px 6px',
                  borderRadius: 99,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                cached
              </span>
            )}
          </div>
          {suggestions.length === 0 ? (
            <p className="t-mdp ink-3 m-0">
              No suggestions returned. Try a more specific niche.
            </p>
          ) : (
            <ul
              style={{
                margin: 0,
                padding: 0,
                listStyle: 'none',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                gap: 6,
              }}
            >
              {suggestions.map((sub) => {
                const added = watchlistSet.has(sub)
                return (
                  <li
                    key={sub}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 10px',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--r-sm)',
                      background: 'var(--surface)',
                    }}
                  >
                    <span
                      className="mono"
                      style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--ink)' }}
                    >
                      r/{sub}
                    </span>
                    {added ? (
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: 'var(--score-high)',
                          background: 'oklch(0.95 0.05 158)',
                          padding: '2px 7px',
                          borderRadius: 99,
                          letterSpacing: '0.02em',
                        }}
                      >
                        Added ✓
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => addSubreddit(sub)}
                      >
                        <Icons.plus size={12} /> Add
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

export function PostsPerScanSelector({
  value,
  onChange,
  disabled,
  options,
}: {
  value: number
  onChange: (n: number) => void
  disabled: boolean
  options: readonly number[]
}) {
  return (
    <label className="pps">
      <span>Posts</span>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
      >
        {options.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </label>
  )
}

// ─── Trend detail panel (replaces orange filter banner) ─────────────────────

export function TrendDetailPanel({
  topic,
  posts,
  insight,
  insightLoading,
  insightError,
  onClear,
}: {
  topic: string
  posts: TaggedPost[]
  insight: string | null
  insightLoading: boolean
  insightError: string | null
  onClear: () => void
}) {
  const opp = computeOpportunity(posts, topic)
  return (
    <div className="card detail fade-in">
      <div className="detail-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 className="detail-title">{topic}</h2>
          <div className="detail-meta">
            {opp.total} post{opp.total === 1 ? '' : 's'}
            {opp.subreddits.length > 0 && (
              <> across {opp.subreddits.map((s) => `r/${s}`).join(', ')}</>
            )}
          </div>
          <div className="detail-badges">
            {opp.painCount > 0 && <CategoryBadge cat="pain_point" count={opp.painCount} />}
            {opp.featureCount > 0 && <CategoryBadge cat="feature_request" count={opp.featureCount} />}
            {opp.toolCount > 0 && <CategoryBadge cat="tool_complaint" count={opp.toolCount} />}
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <ScoreGauge score={opp.scoreRaw} size={72} stroke={6} />
          <div className="gauge-cap">Opportunity</div>
        </div>
        <button type="button" className="detail-clear" onClick={onClear}>
          <Icons.x size={13} /> Clear
        </button>
      </div>
      <div className="detail-insight">
        <span className="spark">
          <Icons.bolt size={15} />
        </span>
        <span>
          {insightLoading && <span style={{ display: 'inline-block', width: '60%', height: '1em', borderRadius: 4, background: 'var(--accent-soft)', verticalAlign: 'middle' }} className="skel" />}
          {!insightLoading && insightError && (
            <span style={{ color: 'var(--pain)' }}>Insight unavailable — {insightError}</span>
          )}
          {!insightLoading && !insightError && insight}
        </span>
      </div>
    </div>
  )
}

// ─── All-time posts view ─────────────────────────────────────────────────────

export function AllTimePostsView({
  topic,
  posts,
  loading,
  error,
  onClear,
  insight,
  insightLoading,
  insightError,
}: {
  topic: string
  posts: TaggedPost[] | null
  loading: boolean
  error: string | null
  onClear: () => void
  insight: string | null
  insightLoading: boolean
  insightError: string | null
}) {
  return (
    <>
      <TrendDetailPanel
        topic={topic}
        posts={posts ?? []}
        insight={insight}
        insightLoading={insightLoading}
        insightError={insightError}
        onClear={onClear}
      />
      {loading && (
        <div className="card" style={{ padding: 'var(--pad)' }}>
          <div className="skel" style={{ height: 16, marginBottom: 8 }} />
          <div className="skel" style={{ height: 14, width: '70%' }} />
        </div>
      )}
      {error && (
        <div className="card" style={{ padding: '14px 17px', color: 'var(--pain)', fontSize: 13 }}>
          {error}
        </div>
      )}
      {!loading && !error && posts && <CategoryGroups posts={posts} />}
    </>
  )
}

// ─── Trends panel + sublists ─────────────────────────────────────────────────

export function TrendsPanel({
  scanTrends,
  posts,
  selectedTopic,
  onSelectTopic,
  tab,
  onTabChange,
  allTimeTrends,
  allTimeLoading,
  allTimeError,
  selectedAllTimeTopic,
  onSelectAllTimeTopic,
}: {
  scanTrends: Trend[]
  posts: TaggedPost[]
  selectedTopic: string | null
  onSelectTopic: (topic: string | null) => void
  tab: TrendsTab
  onTabChange: (tab: TrendsTab) => void
  allTimeTrends: Trend[] | null
  allTimeLoading: boolean
  allTimeError: string | null
  selectedAllTimeTopic: string | null
  onSelectAllTimeTopic: (topic: string | null) => void
}) {
  const trends = tab === 'scan' ? scanTrends : allTimeTrends ?? []
  const sel = tab === 'scan' ? selectedTopic : selectedAllTimeTopic
  const onSel = tab === 'scan' ? onSelectTopic : onSelectAllTimeTopic

  return (
    <section className="section" style={{ marginBottom: 0 }}>
      <div className="section-head">
        <h2>Trends</h2>
        <div className="seg" style={{ marginLeft: 'auto' }}>
          <button
            type="button"
            className={tab === 'scan' ? 'active' : ''}
            onClick={() => onTabChange('scan')}
          >
            Watchlist
          </button>
          <button
            type="button"
            className={tab === 'all' ? 'active' : ''}
            onClick={() => onTabChange('all')}
          >
            All time
          </button>
        </div>
      </div>
      <div className="card">
        {tab === 'all' && allTimeLoading && (
          <div style={{ padding: 12 }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skel" style={{ height: 36, marginBottom: 6 }} />
            ))}
          </div>
        )}
        {tab === 'all' && allTimeError && (
          <div className="empty" style={{ color: 'var(--pain)' }}>
            {allTimeError}
          </div>
        )}
        {trends.length === 0 && !(tab === 'all' && allTimeLoading) && (
          <div className="empty">
            {tab === 'scan'
              ? 'No topic repeated 2+ times in your watchlist yet. Add subs or scan for new posts.'
              : 'No topic has appeared 2+ times across all your scans yet.'}
          </div>
        )}
        {trends.map((t) => {
          const opp = computeOpportunity(posts, t.topic)
          // For all-time topics the opportunity is computed off in-memory posts,
          // which may not include all matches; use the trend's own count instead.
          const oppEffective: Opportunity =
            opp.total > 0 ? opp : { ...opp, total: t.count, subreddits: t.subreddits, score: 0, scoreRaw: 0 }
          const spark = topicSparkline(posts, t.topic, 8)
          return (
            <TrendRow
              key={t.topic}
              opp={oppEffective}
              spark={spark}
              selected={sel === t.topic}
              onSelect={() => onSel(sel === t.topic ? null : t.topic)}
            />
          )
        })}
      </div>
    </section>
  )
}

// ─── Category groups ─────────────────────────────────────────────────────────

export function CategoryGroups({ posts }: { posts: TaggedPost[] }) {
  const grouped: Record<Category, TaggedPost[]> = {
    pain_point: [],
    feature_request: [],
    tool_complaint: [],
    other: [],
  }
  for (const post of posts) grouped[post.category].push(post)
  const visible = CATEGORY_ORDER.filter((c) => grouped[c].length > 0)
  if (posts.length === 0) return <div className="empty">No posts to show.</div>
  return (
    <div>
      {visible.map((cat) => {
        const cfg = CATEGORY_CONFIG[cat]
        const items = grouped[cat]
        const IconC = Icons[cfg.icon] as (p: SimpleIconProps) => React.ReactElement
        return (
          <div className="catgroup" key={cat}>
            <div className="catgroup-head">
              <span style={{ color: `var(--${cfg.cls})`, display: 'inline-flex' }}>
                <IconC size={15} />
              </span>
              <span className="lbl" style={{ color: `var(--${cfg.cls})` }}>
                {cfg.label}
              </span>
              <span className="n">{items.length}</span>
            </div>
            <div className="card">
              {items.map((post) => (
                <PostCard
                  key={`${post.subreddit}:${post.id}`}
                  post={post}
                  showCategoryBadge={false}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Unified PostCard — used by Fresh Signals (compact), CategoryGroups (full),
// and the legacy /r/[sub] view. Renders the post + Deep scan button (when
// eligible and not scanned) + inline insights (when scanned).
//
// `compact` hides the body preview to keep dense lists (Fresh Signals)
// short. Everything else — meta, category badge, Deep scan, insights —
// renders the same in both modes for consistency.
export function PostCard({
  post,
  compact = false,
  showCategoryBadge = true,
}: {
  post: TaggedPost
  compact?: boolean
  /** Hide when the parent already groups by category (CategoryGroups). */
  showCategoryBadge?: boolean
}) {
  const scan = useScanCtx()
  const key = `${post.subreddit}:${post.id}`
  const scanning = scan.deepScanning.has(key)
  const scanError = scan.deepScanErrors[key]
  // Optimistic local state — covers callers that hold their own post list
  // (e.g. the legacy /r/[sub] view) and don't get parent re-renders when
  // useScan patches buckets.
  const [localPatch, setLocalPatch] = useState<{
    tools: string[]
    quotes: CommentQuote[]
    commentsScannedAt: number
    commentsSampled: number
  } | null>(null)
  const tools = localPatch?.tools ?? post.tools
  const quotes = localPatch?.quotes ?? post.quotes
  const commentsScannedAt = localPatch?.commentsScannedAt ?? post.commentsScannedAt
  const sampled = localPatch?.commentsSampled ?? post.commentsSampled
  const hasInsights = commentsScannedAt !== null
  const eligible = post.category !== 'other'

  async function handleDeepScan() {
    const patch = await scan.deepScanPost(post.subreddit, post.id)
    if (patch) setLocalPatch(patch)
  }

  return (
    <div className="post" style={{ flexDirection: 'column', gap: 0, alignItems: 'stretch' }}>
      <div style={{ display: 'flex', gap: 12 }}>
        <div className="post-body">
          <a
            className="post-title"
            href={post.permalink}
            target="_blank"
            rel="noopener noreferrer"
          >
            {post.title}
          </a>
          {!compact && post.is_self && post.selftext && (
            <p className="post-text">{post.selftext}</p>
          )}
          <div className="post-meta">
            <SubChip sub={post.subreddit} />
            {!compact && <span>u/{post.author}</span>}
            {showCategoryBadge && <CategoryBadge cat={post.category} />}
            {post.confidence === 'low' && (
              <span
                title="Classifier had low confidence on this post"
                style={{
                  fontSize: 10.5,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  color: 'var(--ink-4)',
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  padding: '1px 6px',
                  borderRadius: 99,
                }}
              >
                low confidence
              </span>
            )}
            {post.topic && (
              <span
                className="badge"
                style={{ color: 'var(--accent-text)', background: 'var(--accent-soft)' }}
              >
                {post.topic}
              </span>
            )}
            {sampled != null && (
              <span
                className="signal-stat"
                title={`Sampled ${sampled} of up to ${COMMENT_SAMPLE_CAP} top-level comments (Reddit's true total isn't available without OAuth)`}
              >
                <Icons.chat size={11} /> top {sampled} sampled
              </span>
            )}
            <span className="signal-time" style={{ marginLeft: compact ? 'auto' : undefined }}>
              {formatAgo(post.analyzedAt)} ago
            </span>
            {eligible && !hasInsights && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ marginLeft: compact ? undefined : 'auto', padding: '3px 8px' }}
                onClick={handleDeepScan}
                disabled={scanning}
              >
                {scanning ? (
                  <>
                    <Spinner size={11} color="var(--ink-3)" /> Scanning…
                  </>
                ) : (
                  <>
                    <Icons.sparkles size={12} />
                    Deep scan
                  </>
                )}
              </button>
            )}
            {scanError && !scanning && (
              <span style={{ color: 'var(--pain)', fontSize: 11 }}>
                {scanError}
              </span>
            )}
          </div>
        </div>
        <a
          className="ext"
          href={post.permalink}
          target="_blank"
          rel="noopener noreferrer"
          title="View on Reddit"
          aria-label="View on Reddit"
        >
          <Icons.ext />
        </a>
      </div>
      {hasInsights && <PostInsights tools={tools} quotes={quotes} />}
    </div>
  )
}

const QUOTE_TYPE_LABEL: Record<CommentQuote['type'], string> = {
  wish: 'wish',
  switched: 'switched',
  would_pay: 'would pay',
  hate: 'hate',
}
const QUOTE_TYPE_CLS: Record<CommentQuote['type'], string> = {
  wish: 'feature',
  switched: 'tool',
  would_pay: 'pain',
  hate: 'pain',
}

function PostInsights({
  tools,
  quotes,
}: {
  tools: string[] | null
  quotes: CommentQuote[] | null
}) {
  const hasTools = tools && tools.length > 0
  const hasQuotes = quotes && quotes.length > 0
  if (!hasTools && !hasQuotes) {
    return (
      <div
        style={{
          marginTop: 10,
          padding: '8px 11px',
          borderRadius: 'var(--r-sm)',
          background: 'var(--surface-2)',
          fontSize: 11.5,
          color: 'var(--ink-4)',
          fontStyle: 'italic',
        }}
      >
        Deep scan complete · no tool mentions or buying-intent quotes found.
      </div>
    )
  }
  return (
    <div
      style={{
        marginTop: 10,
        padding: '10px 12px',
        borderRadius: 'var(--r)',
        background: 'var(--accent-softer)',
        border: '1px solid var(--accent-soft)',
        display: 'flex',
        flexDirection: 'column',
        gap: 9,
      }}
    >
      {hasTools && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: 'var(--accent-text)',
            }}
          >
            Tools
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {tools!.map((t) => (
              <span
                key={t}
                style={{
                  fontSize: 11.5,
                  fontWeight: 500,
                  color: 'var(--accent-text)',
                  background: 'var(--accent-soft)',
                  padding: '1.5px 7px',
                  borderRadius: 99,
                  fontFamily: 'var(--font-geist-mono), monospace',
                }}
              >
                {t}
              </span>
            ))}
          </div>
        </div>
      )}
      {hasQuotes && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: 'var(--accent-text)',
            }}
          >
            Buying intent
          </span>
          {quotes!.map((q, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'flex-start',
                fontSize: 12.5,
                lineHeight: 1.5,
                color: 'var(--ink-2)',
              }}
            >
              <span
                className={`badge badge-${QUOTE_TYPE_CLS[q.type]}`}
                style={{ flexShrink: 0, marginTop: 1 }}
              >
                {QUOTE_TYPE_LABEL[q.type]}
              </span>
              <span style={{ fontStyle: 'italic' }}>&ldquo;{q.text}&rdquo;</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Breakdown (right-rail on Dashboard) ────────────────────────────────────

export function Breakdown({ posts }: { posts: TaggedPost[] }) {
  const counts: Record<Category, number> = {
    pain_point: 0,
    feature_request: 0,
    tool_complaint: 0,
    other: 0,
  }
  for (const p of posts) counts[p.category]++
  const total = posts.length || 1
  return (
    <div className="card breakdown fade-in">
      {CATEGORY_ORDER.map((cat) => {
        const cfg = CATEGORY_CONFIG[cat]
        const n = counts[cat]
        const IconC = Icons[cfg.icon] as (p: SimpleIconProps) => React.ReactElement
        return (
          <div className="bd-row" key={cat}>
            <span
              className="bd-icon"
              style={{ background: `var(--${cfg.cls}-bg)`, color: `var(--${cfg.cls})` }}
            >
              <IconC size={15} />
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <span className="bd-label">{cfg.label}</span>
                <span className="bd-num" style={{ color: `var(--${cfg.cls})` }}>
                  {n}
                </span>
              </div>
              <div
                className="bd-bar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={total}
                aria-valuenow={n}
                aria-label={`${cfg.label}: ${n} of ${total} posts`}
              >
                <i
                  style={{
                    width: `${(n / total) * 100}%`,
                    background: `var(--${cfg.cls})`,
                  }}
                />
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Signal Volume (8-week sparkline) ────────────────────────────────────────

export function VolumeCard({ posts }: { posts: TaggedPost[] }) {
  const weeks = 8
  const agg = useMemo(() => bucketByWeek(posts, weeks), [posts])
  const max = Math.max(...agg, 1)
  const total = agg.reduce((a, b) => a + b, 0)
  const last = agg[weeks - 1]
  const prev = agg[weeks - 2] || 0
  const delta = prev > 0 ? Math.round(((last - prev) / prev) * 100) : last > 0 ? 100 : 0
  return (
    <div className="card breakdown fade-in">
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <div>
          <div className="tnum" style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em' }}>
            {total}
          </div>
          <div className="t-sm ink-3">signals · 8 weeks</div>
        </div>
        <span
          className="badge"
          style={{ background: delta >= 0 ? 'var(--score-high)' : 'var(--pain)', color: '#fff', opacity: 0.92 }}
        >
          <Icons.up size={11} /> {delta >= 0 ? '+' : ''}
          {delta}%
        </span>
      </div>
      <div
        className="vol"
        role="img"
        aria-label={`8-week signal volume per week: ${agg.join(', ')} (total ${total})`}
      >
        {agg.map((v, i) => (
          <i
            key={i}
            className={i === weeks - 1 ? 'peak' : ''}
            title={
              i === weeks - 1
                ? `this week: ${v}`
                : `${weeks - 1 - i} week${weeks - 1 - i === 1 ? '' : 's'} ago: ${v}`
            }
            style={{ height: `${Math.max(8, (v / max) * 100)}%` }}
          />
        ))}
      </div>
    </div>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

function bucketByWeek(posts: TaggedPost[], weeks: number): number[] {
  const now = Date.now()
  const buckets = new Array<number>(weeks).fill(0)
  for (const p of posts) {
    const ageWeeks = Math.floor((now - p.analyzedAt) / WEEK_MS)
    if (ageWeeks < 0 || ageWeeks >= weeks) continue
    buckets[weeks - 1 - ageWeeks]++
  }
  return buckets
}

export function topicSparkline(posts: TaggedPost[], topic: string, weeks = 8): number[] {
  const filtered = posts.filter((p) => p.topic === topic)
  return bucketByWeek(filtered, weeks)
}

// ─── Effects ─────────────────────────────────────────────────────────────────

/** When the selected scan-topic no longer matches any current trend, clear it. */
export function useDropStaleScanTopic(
  selectedTopic: string | null,
  scanTrends: Trend[],
  onSelectTopic: (topic: string | null) => void,
) {
  const topicSet = new Set(scanTrends.map((t) => t.topic))
  useEffect(() => {
    if (!selectedTopic) return
    // Skip when trends haven't materialized yet — an empty scanTrends here is
    // ambiguous (mid-hydration cached-load race vs. genuinely no data) and
    // clearing the topic in the first case wipes URL-restored deep links.
    // If the user really has no data the user can clear from the panel.
    if (scanTrends.length === 0) return
    if (!topicSet.has(selectedTopic)) onSelectTopic(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTopic, scanTrends])
}
