'use client'

import { useEffect, useMemo, useState } from 'react'
import { HomeHero } from './home-hero'
import { Icons } from './icons'
import { emptyStatusCounts, type LeadStatus } from '@/lib/leads'
import type { MaterializedOpportunity } from '@/lib/advantage'

// Home — the speed-to-lead spine. On a normal day this shows exactly two things:
// a one-line status strip and the single hottest buyer to reply to (HomeHero).
// Opportunities, the weekly digest, and the pipeline live on their own surfaces
// (reached from the nav), so they never compete with the daily reply loop.
export function TodayView() {
  const [oppCount, setOppCount] = useState(0)
  const [freshest, setFreshest] = useState(0)
  const [counts, setCounts] = useState<Record<LeadStatus, number>>(emptyStatusCounts())

  // Counts only — for the one-line status strip. The buyer card (HomeHero) and
  // the heavy surfaces (opportunities/digest/pipeline) fetch their own data.
  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch('/api/opportunities').then((r) => (r.ok ? r.json() : { opportunities: [] })).catch(() => ({ opportunities: [] })),
      fetch('/api/leads').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([oppJson, leadJson]) => {
      if (cancelled) return
      const opps = (oppJson as { opportunities?: MaterializedOpportunity[] }).opportunities ?? []
      setOppCount(opps.length)
      setFreshest(opps.reduce((max, o) => Math.max(max, o.updatedAt ?? 0), 0))
      const c = (leadJson as { counts?: Record<LeadStatus, number> } | null)?.counts
      if (c) setCounts(c)
    })
    return () => { cancelled = true }
  }, [])

  const sinceLine = useMemo(() => {
    const parts: string[] = []
    if (oppCount > 0) parts.push(`${oppCount} opportunit${oppCount === 1 ? 'y' : 'ies'}`)
    if (counts.new > 0) parts.push(`${counts.new} new lead${counts.new === 1 ? '' : 's'}`)
    if (counts.contacted > 0) parts.push(`${counts.contacted} awaiting reply`)
    return parts.length > 0 ? parts.join(' · ') : 'Your market at a glance'
  }, [oppCount, counts.new, counts.contacted])

  return (
    <>
      <div className="today-top">
        <p className="today-since">
          {sinceLine}
          {freshest ? <span className="today-fresh tnum"> · updated {formatAgo(freshest)}</span> : null}
        </p>
        <button
          type="button"
          className="today-ask"
          onClick={() => window.dispatchEvent(new CustomEvent('earwise:open-cmdk', { detail: { mode: 'ask' } }))}
        >
          <Icons.compass size={13} /> Ask your market
        </button>
      </div>

      <HomeHero />

      <div className="today-keys">
        <kbd>⌘K</kbd> search &amp; run
      </div>
    </>
  )
}

function formatAgo(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}
