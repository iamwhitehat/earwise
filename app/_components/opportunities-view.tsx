'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AdvantageOpportunityCard, ExportButtons } from './components'
import { Icons, Spinner } from './icons'
import { useScanCtx } from './scan-provider'
import type { MaterializedOpportunity } from '@/lib/advantage'

// Opportunities — the ranked list (entry to the per-topic workspace). Extracted
// from app/opportunities/page.tsx so it renders as a tab of the Home surface.
// Cards open the /opportunities/[topic] workspace (unchanged).
export function OpportunitiesView() {
  const scan = useScanCtx()
  const router = useRouter()
  const [opps, setOpps] = useState<MaterializedOpportunity[] | null>(null)
  const triedMaterialize = useRef(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/opportunities')
        if (!res.ok) return
        let list = ((await res.json()) as { opportunities?: MaterializedOpportunity[] }).opportunities ?? []
        if (list.length === 0 && scan.posts.length > 0 && !triedMaterialize.current) {
          triedMaterialize.current = true
          const r = await fetch('/api/opportunities/refresh', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
          })
          if (r.ok) list = ((await r.json()) as { opportunities?: MaterializedOpportunity[] }).opportunities ?? []
        }
        if (!cancelled) setOpps(list)
      } catch {
        /* opportunities table may be absent — show empty */
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [scan.posts.length])

  const freshness = useMemo(() => {
    const newest = (opps ?? []).reduce((max, o) => Math.max(max, o.updatedAt ?? 0), 0)
    if (!newest) return null
    const diff = Date.now() - newest
    if (diff < 3_600_000) return `updated ${Math.max(1, Math.floor(diff / 60_000))}m ago`
    if (diff < 86_400_000) return `updated ${Math.floor(diff / 3_600_000)}h ago`
    return `updated ${Math.floor(diff / 86_400_000)}d ago`
  }, [opps])

  const loading = opps === null
  const list = opps ?? []

  return (
    <>
      <div className="section-head">
        <h2>Ranked by Advantage</h2>
        <span className="hint">
          expected value for you — open a card for evidence &amp; the journey
          {freshness ? ` · ${freshness}` : ''}
        </span>
        <span style={{ marginLeft: 'auto' }}>
          <ExportButtons
            filenameStem="opportunities"
            disabled={list.length === 0}
            build={() => ({
              headers: ['rank', 'topic', 'advantage', 'demand', 'monetization', 'momentum', 'whitespace', 'fit_to_you', 'posts', 'sources'],
              rows: list.map((o, i) => [
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
        </span>
      </div>

      {loading && (
        <div className="empty" style={{ padding: 40 }}>
          <Spinner size={18} color="var(--ink-3)" /> Loading opportunities…
        </div>
      )}

      {!loading && list.length === 0 && (
        <div className="card empty fade-in">
          <span className="e-ico"><Icons.radar size={26} /></span>
          <div>
            No opportunities yet. Add subreddits and run a scan on{' '}
            <a href="/explore" className="accent-link" style={{ color: 'var(--accent-text)' }}>Discover</a> to surface them.
          </div>
        </div>
      )}

      {!loading && list.length > 0 && (
        <div className="opp-grid">
          {list.map((opp, i) => (
            <AdvantageOpportunityCard
              key={opp.topic}
              opp={opp}
              rank={i}
              selected={false}
              onSelect={() => router.push(`/opportunities/${encodeURIComponent(opp.topic)}`)}
            />
          ))}
        </div>
      )}
    </>
  )
}
