'use client'

import { useEffect, useMemo, useState } from 'react'
import { Icons, Spinner } from '../_components/icons'
import { useScanCtx } from '../_components/scan-provider'
import {
  BuyerLanguagePanel,
  MessagingSections,
  StalenessBanner,
  SynthModelSelect,
  Topbar,
  collectSubreddits,
  filterLangItems,
  type BuyerLanguageData,
} from '../_components/components'
import { useSynthModel } from '@/lib/use-synth-model'
import { CATEGORY_CONFIG, CATEGORY_ORDER, type Category } from '@/lib/categories'

type CatFilter = 'all' | Category

function formatAgo(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

export default function BuyerLanguagePage() {
  const scan = useScanCtx()
  const { tier, setTier } = useSynthModel()
  const [data, setData] = useState<BuyerLanguageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [subFilter, setSubFilter] = useState<string>('all')
  const [catFilter, setCatFilter] = useState<CatFilter>('all')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch('/api/buyer-language')
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`)
        if (!cancelled) setData(json as BuyerLanguageData | null)
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
      const res = await fetch('/api/buyer-language/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tier }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`)
      setData(json as BuyerLanguageData)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh failed')
    } finally {
      setRefreshing(false)
    }
  }

  // Sub list derived from current data; if no enrichment exists, dropdown is
  // empty and filters silently no-op (rows pass through unchanged).
  const availableSubs = useMemo(
    () => (data ? collectSubreddits(data) : []),
    [data],
  )
  const filtersActive = availableSubs.length > 0
  const filtered = useMemo(() => {
    if (!data) return null
    return {
      phrases: filterLangItems(data.phrases, subFilter, catFilter),
      tools: filterLangItems(data.tools, subFilter, catFilter),
      emotional: filterLangItems(data.emotional, subFilter, catFilter),
    }
  }, [data, subFilter, catFilter])

  return (
    <>
      <Topbar title="Buyer Language" posts={scan.posts}>
        <SynthModelSelect value={tier} onChange={setTier} disabled={refreshing} />
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={handleRefresh}
          disabled={refreshing}
        >
          {refreshing ? (
            <>
              <Spinner size={13} /> Refreshing…
            </>
          ) : (
            <>
              <Icons.sparkles size={14} /> Refresh language
            </>
          )}
        </button>
      </Topbar>

      <div className="content scroll">
        <StalenessBanner
          generatedAt={data?.generatedAt ?? null}
          onRefresh={handleRefresh}
          refreshing={refreshing}
          label="This buyer-language run"
        />

        {loading && !data && (
          <div className="card" style={{ padding: 'var(--pad)' }}>
            <div className="skel" style={{ height: 14, width: '40%', marginBottom: 8 }} />
            <div className="skel" style={{ height: 80 }} />
          </div>
        )}

        {error && !data && (
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

        {!loading && !data && !error && (
          <div className="card empty fade-in">
            <span className="e-ico">
              <Icons.sparkles size={28} />
            </span>
            <div>
              No buyer-language data yet. Click <strong>Refresh language</strong> to extract
              the recurring phrases, tools, and emotional words from your scanned posts and
              deep-scanned comments.
            </div>
          </div>
        )}

        {data && (
          <>
            {/* Filter row + stats line */}
            <div
              className="card fade-in"
              style={{
                padding: '12px 16px',
                marginBottom: 'var(--gap)',
                display: 'flex',
                gap: 14,
                alignItems: 'center',
                flexWrap: 'wrap',
              }}
            >
              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12,
                  color: 'var(--ink-3)',
                }}
              >
                <span>Subreddit</span>
                <select
                  value={subFilter}
                  onChange={(e) => setSubFilter(e.target.value)}
                  disabled={availableSubs.length === 0}
                  aria-disabled={availableSubs.length === 0}
                  title={
                    availableSubs.length === 0
                      ? "This run was generated before per-row contexts were stored; filtering by sub would be a no-op. Click 'Refresh language' to regenerate with context tags."
                      : undefined
                  }
                  style={{
                    background: 'var(--surface)',
                    color: 'var(--ink)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--r-sm)',
                    padding: '4px 8px',
                    font: 'inherit',
                    fontFamily: 'var(--font-geist-mono), monospace',
                    fontSize: 12,
                  }}
                >
                  <option value="all">All subs</option>
                  {availableSubs.map((s) => (
                    <option key={s} value={s}>
                      r/{s}
                    </option>
                  ))}
                </select>
              </label>
              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12,
                  color: 'var(--ink-3)',
                }}
              >
                <span>Category</span>
                <select
                  value={catFilter}
                  onChange={(e) => setCatFilter(e.target.value as CatFilter)}
                  disabled={!filtersActive}
                  aria-disabled={!filtersActive}
                  title={
                    !filtersActive
                      ? "This run was generated before per-row contexts were stored; filtering by category would be a no-op. Click 'Refresh language' to regenerate with context tags."
                      : undefined
                  }
                  style={{
                    background: 'var(--surface)',
                    color: 'var(--ink)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--r-sm)',
                    padding: '4px 8px',
                    font: 'inherit',
                    fontSize: 12,
                  }}
                >
                  <option value="all">All categories</option>
                  {CATEGORY_ORDER.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_CONFIG[c].label}
                    </option>
                  ))}
                </select>
              </label>
              {!filtersActive && (
                <span className="t-sm ink-4">
                  Run Refresh to enable filters
                </span>
              )}
              <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-3)' }}>
                from{' '}
                <span className="tnum" style={{ color: 'var(--ink)', fontWeight: 500 }}>
                  {data.stats.postCount}
                </span>{' '}
                posts ·{' '}
                <span className="tnum" style={{ color: 'var(--ink)', fontWeight: 500 }}>
                  {data.stats.commentCount}
                </span>{' '}
                comments · generated{' '}
                <span style={{ color: 'var(--ink)', fontWeight: 500 }}>
                  {formatAgo(data.generatedAt)}
                </span>
              </span>
            </div>

            <BuyerLanguagePanel
              data={{ ...data, phrases: filtered!.phrases, tools: filtered!.tools, emotional: filtered!.emotional }}
              loading={false}
              error={null}
              refreshing={refreshing}
              onRefresh={handleRefresh}
              layout="stacked"
              showHeader={false}
              renderCopyButtons
            />

            {data.messaging && <MessagingSections messaging={data.messaging} />}
          </>
        )}
      </div>
    </>
  )
}
