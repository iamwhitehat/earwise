'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Icons, Spinner } from './icons'
import type { MaterializedOpportunity } from '@/lib/advantage'

// Pipeline › Reach (REDESIGN-SPEC › "Pot do strank"): operational distribution.
// Where your buyers are (signal density), this week's moves (direct + broad,
// resumable checklist), content angles (spiking topics + buyer phrases), and
// guardrails. Derived from existing data — no new endpoints.
type SignalLite = { subreddit: string }
type Phrase = { text: string }

const MOVES_KEY = 'earwise:reach-moves'

type Move = { id: string; text: string; kind: 'direct' | 'broad'; href?: string }

export function ReachView() {
  const [subCounts, setSubCounts] = useState<[string, number][]>([])
  const [newLeads, setNewLeads] = useState(0)
  const [opps, setOpps] = useState<MaterializedOpportunity[]>([])
  const [phrases, setPhrases] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [done, setDone] = useState<Record<string, boolean>>({})

  useEffect(() => {
    try {
      const raw = localStorage.getItem(MOVES_KEY)
      if (raw) setDone(JSON.parse(raw))
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch('/api/signals?age=week').then((r) => (r.ok ? r.json() : { signals: [] })).catch(() => ({ signals: [] })),
      fetch('/api/leads').then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch('/api/opportunities').then((r) => (r.ok ? r.json() : { opportunities: [] })).catch(() => ({ opportunities: [] })),
      fetch('/api/buyer-language').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ])
      .then(([sigJson, leadJson, oppJson, blJson]) => {
        if (cancelled) return
        const signals = (sigJson as { signals?: SignalLite[] }).signals ?? []
        const counts = new Map<string, number>()
        for (const s of signals) counts.set(s.subreddit, (counts.get(s.subreddit) ?? 0) + 1)
        setSubCounts([...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8))
        setNewLeads((leadJson as { counts?: { new?: number } } | null)?.counts?.new ?? 0)
        setOpps((oppJson as { opportunities?: MaterializedOpportunity[] }).opportunities ?? [])
        const pl = (blJson as { phrases?: Phrase[] } | null)?.phrases ?? []
        setPhrases(pl.map((p) => (typeof p?.text === 'string' ? p.text : '')).filter(Boolean).slice(0, 6))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const moves = useMemo<Move[]>(() => {
    const out: Move[] = []
    if (newLeads > 0) {
      out.push({ id: 'direct-leads', kind: 'direct', text: `Reply to ${newLeads} high-intent lead${newLeads === 1 ? '' : 's'}`, href: '/pipeline' })
    }
    const topSub = subCounts[0]?.[0]
    if (topSub && opps[0]) {
      out.push({ id: 'broad-answer', kind: 'broad', text: `Helpful answer in r/${topSub} → “${opps[0].topic}”`, href: `/opportunities/${encodeURIComponent(opps[0].topic)}` })
    }
    if (opps[1]) {
      out.push({ id: 'broad-publish', kind: 'broad', text: `Publish: a “${opps[1].topic}” angle`, href: `/opportunities/${encodeURIComponent(opps[1].topic)}` })
    }
    return out
  }, [newLeads, subCounts, opps])

  function toggle(id: string) {
    setDone((prev) => {
      const next = { ...prev, [id]: !prev[id] }
      try { localStorage.setItem(MOVES_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }

  const maxCount = subCounts[0]?.[1] ?? 1

  if (loading) {
    return <div className="empty" style={{ padding: 40 }}><Spinner size={18} color="var(--ink-3)" /> Loading reach…</div>
  }

  return (
    <div className="reach">
      {/* Where your buyers are */}
      <section className="section">
        <div className="section-head"><h2>Where your buyers are</h2><span className="hint">high-intent signal density · last 7d</span></div>
        {subCounts.length === 0 ? (
          <div className="card empty"><span className="e-ico"><Icons.compass size={22} /></span><div>No signals yet — run a scan to see where demand concentrates.</div></div>
        ) : (
          <div className="reach-density">
            {subCounts.map(([sub, n]) => (
              <div className="reach-dens-row" key={sub}>
                <span className="reach-dens-sub mono">r/{sub}</span>
                <span className="reach-dens-bar"><i style={{ width: `${Math.round((n / maxCount) * 100)}%` }} /></span>
                <span className="reach-dens-n tnum">{n}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* This week's moves */}
      <section className="section">
        <div className="section-head"><h2>This week&apos;s moves</h2><span className="hint">direct + broad · resumable</span></div>
        {moves.length === 0 ? (
          <div className="card empty"><span className="e-ico"><Icons.flag size={22} /></span><div>No moves yet — add leads and scan to generate this week&apos;s plan.</div></div>
        ) : (
          <ul className="reach-moves">
            {moves.map((m) => (
              <li key={m.id} className={`reach-move${done[m.id] ? ' done' : ''}`}>
                <button type="button" className="reach-check" onClick={() => toggle(m.id)} aria-pressed={!!done[m.id]} aria-label="Toggle done">
                  {done[m.id] ? '✓' : ''}
                </button>
                <span className="reach-move-text">{m.text}</span>
                <span className={`reach-tag reach-${m.kind}`}>{m.kind}</span>
                {m.href && <Link href={m.href} className="reach-go">→</Link>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Content angles */}
      <section className="section">
        <div className="section-head"><h2>Content angles</h2><span className="hint">spiking topics + the phrases that resonate</span></div>
        {opps.length === 0 ? (
          <div className="card empty"><span className="e-ico"><Icons.sparkles size={22} /></span><div>No angles yet — opportunities populate after a scan.</div></div>
        ) : (
          <div className="reach-angles">
            {opps.slice(0, 4).map((o) => (
              <div className="reach-angle" key={o.topic}>
                <div className="reach-angle-top">
                  <span className="reach-angle-topic">{o.topic}</span>
                  <Link href={`/opportunities/${encodeURIComponent(o.topic)}`} className="reach-angle-draft">draft →</Link>
                </div>
                <div className="reach-angle-sub tnum">{o.posts} posts · {o.subreddits.slice(0, 3).map((s) => `r/${s}`).join(' · ')}</div>
              </div>
            ))}
            {phrases.length > 0 && (
              <div className="reach-phrases">
                <span className="reach-phrases-label">Exact phrases buyers use:</span>
                {phrases.map((p) => (<span key={p} className="reach-phrase">“{p}”</span>))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Guardrails */}
      <section className="section">
        <div className="card reach-guard">
          <Icons.flag size={14} />
          <span><strong>Be helpful first.</strong> Lead with value, never a pitch — and space out posts in the same community to protect your reputation.</span>
        </div>
      </section>
    </div>
  )
}
