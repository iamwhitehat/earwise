'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Topbar, AdvantageOpportunityCard, HotNowLane } from '../_components/components'
import { Icons, Spinner } from '../_components/icons'
import { useScanCtx } from '../_components/scan-provider'
import type { MaterializedOpportunity } from '@/lib/advantage'
import { emptyStatusCounts, type LeadStatus } from '@/lib/leads'

// Today — the triage inbox (REDESIGN-SPEC › Zaslon 1). A prioritized queue of
// decisions, not a dashboard: hot signals to reply to, opportunities to
// pursue/park, and the pipeline nudge. Reuses HotNowLane + AdvantageOpportunityCard.
const TOP_OPPS = 3

export default function TodayPage() {
  const scan = useScanCtx()
  const router = useRouter()
  const [opps, setOpps] = useState<MaterializedOpportunity[] | null>(null)
  const [counts, setCounts] = useState<Record<LeadStatus, number>>(emptyStatusCounts())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch('/api/opportunities').then((r) => (r.ok ? r.json() : { opportunities: [] })).catch(() => ({ opportunities: [] })),
      fetch('/api/leads').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ])
      .then(([oppJson, leadJson]) => {
        if (cancelled) return
        setOpps((oppJson as { opportunities?: MaterializedOpportunity[] }).opportunities ?? [])
        if (leadJson && (leadJson as { counts?: Record<LeadStatus, number> }).counts) {
          setCounts((leadJson as { counts: Record<LeadStatus, number> }).counts)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const topOpps = useMemo(() => (opps ?? []).slice(0, TOP_OPPS), [opps])
  const freshest = useMemo(
    () => (opps ?? []).reduce((max, o) => Math.max(max, o.updatedAt ?? 0), 0),
    [opps],
  )
  const newLeads = counts.new
  const contacted = counts.contacted

  const sinceLine = useMemo(() => {
    const parts: string[] = []
    if ((opps?.length ?? 0) > 0) parts.push(`${opps!.length} opportunit${opps!.length === 1 ? 'y' : 'ies'}`)
    if (newLeads > 0) parts.push(`${newLeads} new lead${newLeads === 1 ? '' : 's'}`)
    if (contacted > 0) parts.push(`${contacted} awaiting reply`)
    return parts.length > 0 ? parts.join(' · ') : 'Your market at a glance'
  }, [opps, newLeads, contacted])

  // Inbox-zero only once everything has loaded and the hot lane is empty too —
  // HotNowLane hides itself when empty, so we gate the "caught up" card on opps/leads.
  const nothing = !loading && topOpps.length === 0 && newLeads === 0 && contacted === 0

  return (
    <>
      <Topbar title="Today" posts={scan.posts}>
        <span className="today-fresh tnum">
          {freshest ? `updated ${formatAgo(freshest)}` : ''}
        </span>
      </Topbar>

      <div className="content scroll">
        <div className="today-top">
          <p className="today-since">{sinceLine}</p>
          <button
            type="button"
            className="today-ask"
            onClick={() => window.dispatchEvent(new CustomEvent('earwise:open-cmdk', { detail: { mode: 'ask' } }))}
          >
            <Icons.compass size={13} /> Ask your market
          </button>
        </div>

        <HotNowLane />

        {loading && (
          <div className="empty" style={{ padding: 40 }}>
            <Spinner size={18} color="var(--ink-3)" /> Loading your triage…
          </div>
        )}

        {!loading && (newLeads > 0 || contacted > 0) && (
          <section className="section">
            <div className="section-head">
              <h2>Pipeline</h2>
              <span className="hint">turn intent into conversations</span>
            </div>
            <div className="today-card">
              <div className="today-card-main">
                <span className="today-card-type">Leads · high intent</span>
                <p className="today-card-title">
                  {newLeads > 0
                    ? `${newLeads} new lead${newLeads === 1 ? '' : 's'} ready for a first message`
                    : `${contacted} contacted — follow up while it's warm`}
                </p>
              </div>
              <Link href="/pipeline" className="btn btn-primary btn-sm">
                {newLeads > 0 ? 'Draft openers' : 'Open pipeline'}
              </Link>
            </div>
          </section>
        )}

        {!loading && topOpps.length > 0 && (
          <section className="section">
            <div className="section-head">
              <h2>Opportunities to decide</h2>
              <span className="pill">ranked by Advantage</span>
              <Link href="/opportunities" className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto', textDecoration: 'none' }}>
                View all <Icons.chev size={12} />
              </Link>
            </div>
            <div className="opp-grid">
              {topOpps.map((opp, i) => (
                <AdvantageOpportunityCard
                  key={opp.topic}
                  opp={opp}
                  rank={i}
                  selected={false}
                  onSelect={() => router.push(`/opportunities/${encodeURIComponent(opp.topic)}`)}
                />
              ))}
            </div>
          </section>
        )}

        {nothing && (
          <div className="card empty fade-in">
            <span className="e-ico">
              <Icons.radar size={26} />
            </span>
            <div style={{ marginBottom: 14 }}>
              You&apos;re caught up. Run a scan to surface fresh demand, or explore your opportunities.
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={scan.scanAll}
                disabled={scan.anyStreaming}
              >
                {scan.anyStreaming ? <><Spinner size={13} /> Scanning…</> : <><Icons.scan size={14} /> Run a scan</>}
              </button>
              <Link href="/" className="btn btn-ghost" style={{ textDecoration: 'none' }}>
                Explore opportunities
              </Link>
            </div>
          </div>
        )}

        <div className="today-keys">
          <kbd>⌘K</kbd> search &amp; run · <kbd>e</kbd> act · <kbd>s</kbd> snooze · <kbd>j/k</kbd> move
        </div>
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
