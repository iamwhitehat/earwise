'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useScanCtx } from './scan-provider'
import type { MaterializedOpportunity } from '@/lib/advantage'

// Earwise — Demand · Opportunities (handoff Demand.html / spec §6.3). From a wall
// of data to the ONE thing worth today: a system-ranked hero opportunity, the
// rest collapsed, one score everywhere. Ends in an action (the Act sheet), not a
// decision: reply routes to Warm Leads filtered to the cluster; post drafts the
// angle; blog saves the idea. Wired to /api/opportunities + /api/posts-by-topic.
type Toast = { id: number; kind: string; msg: string }
type Evi = { sub: string; author: string; quote: string }

const scoreOf = (o: MaterializedOpportunity) => Math.round((o.advantage || 0) * 100)
const isWarm = (o: MaterializedOpportunity) => scoreOf(o) < 70
function trendOf(m: number): string {
  return m >= 0.66 ? '↑ rising fast' : m >= 0.5 ? '↑ rising' : m >= 0.33 ? '→ stable' : '↓ cooling'
}
function metaOf(o: MaterializedOpportunity): string {
  const subs = (o.subreddits ?? []).slice(0, 3).map((s) => `r/${s}`).join(' ')
  return `${o.posts} post${o.posts === 1 ? '' : 's'}${subs ? ` · ${subs}` : ''} · ${trendOf(o.momentum)}`
}
function insightOf(o: MaterializedOpportunity): string {
  const parts = [
    { v: o.whitespace, t: 'an open lane — strong demand with few existing solutions' },
    { v: o.monetization, t: 'buyers signalling real willingness to pay' },
    { v: o.demand, t: 'loud, recurring demand across your sources' },
    { v: o.momentum, t: 'momentum building fast right now' },
  ].sort((a, b) => b.v - a.v)
  return `${o.posts} post${o.posts === 1 ? '' : 's'} on this — ${parts[0].t}.`
}
const titleCase = (t: string) => t.replace(/\b\w/g, (c) => c.toUpperCase())

export function Demand() {
  const router = useRouter()
  const scan = useScanCtx()
  const [opps, setOpps] = useState<MaterializedOpportunity[] | null>(null)
  const [showEvidence, setShowEvidence] = useState(false)
  const [evidence, setEvidence] = useState<Evi[] | null>(null)
  const [showMore, setShowMore] = useState(false)
  const [sheet, setSheet] = useState<MaterializedOpportunity | null>(null)

  const [toasts, setToasts] = useState<Toast[]>([])
  const toastId = useRef(0)
  const push = useCallback((kind: string, msg: string) => {
    const id = ++toastId.current
    setToasts((t) => [...t, { id, kind, msg }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000)
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch('/api/opportunities')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((j: { opportunities?: MaterializedOpportunity[] } | null) => {
        if (!cancelled) setOpps(j?.opportunities ?? [])
      })
    return () => { cancelled = true }
  }, [])

  const hero = opps?.[0] ?? null
  const next = useMemo(() => (opps ?? []).slice(1, 3), [opps])
  const rest = useMemo(() => (opps ?? []).slice(3), [opps])

  // Lazy-load the cited threads for the hero topic on first reveal.
  useEffect(() => {
    if (!showEvidence || !hero || evidence !== null) return
    let cancelled = false
    fetch(`/api/posts-by-topic?topic=${encodeURIComponent(hero.topic)}`)
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => [])
      .then((rows: Array<Record<string, unknown>>) => {
        if (cancelled) return
        const evi = (Array.isArray(rows) ? rows : []).slice(0, 3).map((p) => ({
          sub: (p.subreddit as string) ?? '',
          author: (p.author as string) || 'unknown',
          quote: `${(p.title as string) ?? ''} ${(p.selftext as string) ?? ''}`.replace(/\s+/g, ' ').trim().slice(0, 200),
        }))
        setEvidence(evi)
      })
    return () => { cancelled = true }
  }, [showEvidence, hero, evidence])

  function recommend(o: MaterializedOpportunity): 'post' | 'reply' {
    return o.momentum >= 0.5 && o.posts >= 8 ? 'post' : 'reply'
  }
  function surfaceLeads(o: MaterializedOpportunity) {
    setSheet(null)
    push('→ warm leads', `Filtering Warm leads to "${titleCase(o.topic)}"`)
    router.push(`/warm-leads?opp=${encodeURIComponent(o.topic)}`)
  }
  function writePost(o: MaterializedOpportunity) {
    const body = `${titleCase(o.topic)}\n\n${insightOf(o)}\n\nCurious how others are handling it — what's actually worked, and what hasn't?`
    void navigator.clipboard?.writeText(body).catch(() => {})
    setSheet(null)
    push('⧉ post copied', 'Drafted a post on the angle — copied, paste into Reddit')
  }
  function saveBlogIdea(o: MaterializedOpportunity) {
    try {
      const k = 'earwise.blogideas'
      const a = JSON.parse(localStorage.getItem(k) || '[]')
      a.push({ title: titleCase(o.topic), angle: insightOf(o), at: Date.now() })
      localStorage.setItem(k, JSON.stringify(a))
    } catch { /* storage unavailable */ }
    setSheet(null)
    push('▤ saved', 'Saved to blog ideas — for off-Reddit repurposing later')
  }

  function OppRow({ o, rank }: { o: MaterializedOpportunity; rank: number }) {
    return (
      <div className="ocard">
        <span className="orank">{rank}</span>
        <div className={`sc${isWarm(o) ? ' warm' : ''}`}><b>{scoreOf(o)}</b><span>SCORE</span></div>
        <div className="bd"><h4>{titleCase(o.topic)}</h4><div className="mt">{metaOf(o)}</div></div>
        <div className="ac"><button type="button" className="go-s" onClick={() => setSheet(o)}>Act →</button></div>
      </div>
    )
  }

  const rec = sheet ? recommend(sheet) : 'reply'

  return (
    <div className="ew">
      <div className="main-wrap">
        <div className="mh"><span className="bdg">Demand</span><h1>What your market wants</h1></div>
        <div className="msub">Your single best opportunity today. Act on it, or browse the rest below.</div>

        {opps === null ? (
          <div className="db-loading"><span className="spin" /> Ranking your opportunities…</div>
        ) : !hero ? (
          <div className="zero">
            <div className="zmk">◦</div>
            <h3>No opportunities surfaced yet</h3>
            <p>Your sources haven&apos;t turned up enough signal to rank. Run a scan to read your market — it takes about a minute.</p>
            <div className="act">
              <button type="button" className="zp" onClick={() => { scan.scanAll(); push('scan', 'Reading your sources for fresh demand…') }}>⟳ Scan for demand</button>
            </div>
          </div>
        ) : (
          <>
            <div className="hero-opp">
              <div className="htag">★ Best opportunity today <span className="hrank">· #1</span></div>
              <div className="htop">
                <div className="score"><b>{scoreOf(hero)}</b><span>SCORE</span></div>
                <div>
                  <h3>{titleCase(hero.topic)}</h3>
                  <div className="mt">{metaOf(hero)}</div>
                  <div className="in">{insightOf(hero)}</div>
                </div>
              </div>
              <div className="acts">
                <button type="button" className="go-p" onClick={() => setSheet(hero)}>Act on this →</button>
                <button type="button" className="sec" onClick={() => setShowEvidence((v) => !v)}>{showEvidence ? 'Hide evidence' : 'See evidence'}</button>
              </div>
              {showEvidence && (
                <div className="evidence">
                  <div className="eh">Evidence · {evidence ? `${evidence.length} cited threads` : 'loading…'}</div>
                  {(evidence ?? []).map((e, i) => (
                    <div className="equote" key={i}>
                      <div className="src"><span>r/{e.sub} · u/{e.author}</span></div>
                      <div className="qt">&ldquo;{e.quote}&rdquo;</div>
                    </div>
                  ))}
                  {evidence && evidence.length === 0 && <div className="qt" style={{ color: 'var(--muted)' }}>No cited threads found for this topic yet.</div>}
                </div>
              )}
            </div>

            {next.map((o, i) => <OppRow key={o.topic} o={o} rank={i + 2} />)}
            {showMore && rest.map((o, i) => <OppRow key={o.topic} o={o} rank={i + 4} />)}
            {rest.length > 0 && (
              <button type="button" className="more-cta" onClick={() => setShowMore((v) => !v)}>
                {showMore ? '− Show fewer' : `+ ${rest.length} more opportunit${rest.length === 1 ? 'y' : 'ies'}`}
              </button>
            )}
          </>
        )}
      </div>

      <div className="toast-wrap">
        {toasts.map((t) => <div className="toast" key={t.id}><span className="ti">{t.kind}</span><span>{t.msg}</span></div>)}
      </div>

      {sheet && (
          <div className="modal-bg" onClick={() => setSheet(null)}>
            <div className="act-sheet" onClick={(e) => e.stopPropagation()}>
              <div className="act-head">
                <div className="asc"><b>{scoreOf(sheet)}</b><span>SCORE</span></div>
                <div><h4>{titleCase(sheet.topic)}</h4><div className="amt">{metaOf(sheet)}</div></div>
              </div>
              <div className="act-q">How do you want to act on this?</div>

              <div className={`act-route${rec === 'post' ? ' rec' : ''}`}>
                <div className="rtop">
                  <span className="ricon" style={{ color: 'var(--lime)' }}>✈</span>
                  <span className="rtitle">Write a post</span>
                  {rec === 'post' && <span className="recpill">RECOMMENDED</span>}
                </div>
                <div className="rsub">One post on this angle. Most reach, lowest spam risk — the angle&apos;s pre-validated by {sheet.posts} posts.</div>
                <button type="button" className={`rbtn${rec === 'post' ? '' : ' out'}`} onClick={() => writePost(sheet)}>Write post →</button>
              </div>

              <div className={`act-route${rec === 'reply' ? ' rec' : ''}`}>
                <div className="rtop">
                  <span className="ricon" style={{ color: '#7fb8d4' }}>↩</span>
                  <span className="rtitle">Reply to the cluster</span>
                  {rec === 'reply' && <span className="recpill">RECOMMENDED</span>}
                </div>
                <div className="rsub">Filter Warm leads to this cluster — reply 1:1 under your daily cap. Higher intent.</div>
                <button type="button" className={`rbtn${rec === 'reply' ? '' : ' out'}`} onClick={() => surfaceLeads(sheet)}>Surface leads →</button>
              </div>

              <button type="button" className="act-blog" onClick={() => saveBlogIdea(sheet)}>
                ▤ Save as a blog idea<span className="bmeta">off-Reddit · later</span>
              </button>
            </div>
          </div>
      )}
    </div>
  )
}
