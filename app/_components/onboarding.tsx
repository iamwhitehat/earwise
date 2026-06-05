'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useScanCtx, useWatchlistCtx } from './scan-provider'
import { useSubSuggestions } from '@/lib/use-sub-suggestions'
import type { MaterializedOpportunity } from '@/lib/advantage'

// Earwise — Onboarding funnel (handoff Onboarding.html, spec §6.1). Zero →
// "this is valuable" in ~60s, four steps, one action each, landing on the Daily
// Brief. Wired: market → project niche (PATCH /api/projects); sources → real
// /api/suggest-subs → the watchlist; scan → the real scan engine; reveal → the
// top materialized opportunity.
const titleCase = (t: string) => t.replace(/\b\w/g, (c) => c.toUpperCase())
function trendOf(m: number): string {
  return m >= 0.66 ? '↑ rising fast' : m >= 0.5 ? '↑ rising' : m >= 0.33 ? '→ stable' : '↓ cooling'
}

const Mark = () => (
  <svg width="26" height="26" viewBox="0 0 256 256" aria-hidden="true">
    <g transform="translate(-16 6)">
      <circle cx="96" cy="170" r="15" fill="#0a0c0a" />
      <path d="M135,170 A39,39 0 0 0 96,131" fill="none" stroke="#0a0c0a" strokeWidth="18" strokeLinecap="round" />
      <path d="M167,170 A71,71 0 0 0 96,99" fill="none" stroke="#0a0c0a" strokeWidth="18" strokeLinecap="round" />
      <path d="M199,170 A103,103 0 0 0 96,67" fill="none" stroke="#0a0c0a" strokeWidth="18" strokeLinecap="round" />
    </g>
  </svg>
)

type ScanRow = { name: string; phase: 'idle' | 'read' | 'classify' | 'done'; pct: number; count: number }

export function Onboarding() {
  const router = useRouter()
  const scan = useScanCtx()
  const { addSubreddit } = useWatchlistCtx()
  const { suggestions, loading: suggesting, suggest } = useSubSuggestions()

  const [step, setStep] = useState(0)
  const [market, setMarket] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const marketRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (step === 0) marketRef.current?.focus() }, [step])

  // Pre-select all suggestions the first time they arrive.
  useEffect(() => {
    if (step === 1 && suggestions && picked.size === 0) setPicked(new Set(suggestions))
  }, [suggestions, step, picked.size])

  function goSources() {
    const m = market.trim()
    if (!m) return
    // Save the niche (drives relevance) + ask for the real subreddit suggestions.
    void fetch('/api/projects', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ niche: m }) }).catch(() => {})
    setPicked(new Set())
    void suggest(m)
    setStep(1)
  }
  function toggle(s: string) {
    setPicked((prev) => { const n = new Set(prev); if (n.has(s)) n.delete(s); else n.add(s); return n })
  }
  function startListening() {
    if (picked.size === 0) return
    for (const s of picked) addSubreddit(s)
    setStep(2)
  }

  const pickedList = suggestions ? suggestions.filter((s) => picked.has(s)) : [...picked]

  return (
    <div className="ew">
      <div className="onb">
        <div className="onb-inner">
          <div className="dots">{[0, 1, 2, 3].map((i) => <span key={i} className={i < step ? 'done' : i === step ? 'cur' : ''} />)}</div>

          {step === 0 && (
            <div className="step">
              <div className="omk"><Mark /></div>
              <h2>What&apos;s your market?</h2>
              <div className="sub">Tell earwise who your buyers are. It finds where they talk.</div>
              <form className="oinput" onSubmit={(e) => { e.preventDefault(); goSources() }}>
                <span className="mag">🔍</span>
                <input ref={marketRef} value={market} onChange={(e) => setMarket(e.target.value)} placeholder="e.g. IT managers, SaaS founders, e-commerce…" />
              </form>
              <div><button type="button" className="obtn" disabled={!market.trim()} onClick={goSources}>Find where they talk →</button></div>
              <span className="oskip" onClick={() => router.push('/today')}>Skip — set up manually</span>
            </div>
          )}

          {step === 1 && (
            <div className="step">
              <div className="omk"><Mark /></div>
              <h2>Here&apos;s where they talk</h2>
              <div className="sub">earwise found these communities for <b style={{ color: 'var(--text)' }}>{market}</b>. Deselect any you don&apos;t want.</div>
              {suggesting && (!suggestions || suggestions.length === 0) ? (
                <div className="selnote">Finding communities…</div>
              ) : (
                <>
                  <div className="osug">
                    {(suggestions ?? []).map((s) => (
                      <button key={s} type="button" className={`s${picked.has(s) ? ' pick' : ''}`} onClick={() => toggle(s)}>r/{s}<span className="ck">✓</span></button>
                    ))}
                  </div>
                  <div className="selnote">{picked.size} of {suggestions?.length ?? 0} selected</div>
                </>
              )}
              <div><button type="button" className="obtn" disabled={picked.size === 0} onClick={startListening}>Start listening →</button></div>
            </div>
          )}

          {step === 2 && <StepScanning sources={pickedList} onStart={() => scan.scanAll()} onDone={() => setStep(3)} />}

          {step === 3 && <StepReveal onGo={() => router.push('/today')} />}
        </div>
      </div>
    </div>
  )
}

function StepScanning({ sources, onStart, onDone }: { sources: string[]; onStart: () => void; onDone: () => void }) {
  const list = sources.length > 0 ? sources : ['your sources']
  const [rows, setRows] = useState<ScanRow[]>(() => list.map((s) => ({ name: s, phase: 'idle', pct: 0, count: 0 })))
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    onStart() // kick off the real scan in the background
    const startedAt = Date.now()
    const perStep = 22 // ms per +1% of a 0..200 read→classify sweep
    const stagger = 360
    const totalMs = perStep * 200 + (list.length - 1) * stagger + 250
    let done = false
    const id = setInterval(() => {
      const now = Date.now()
      setRows((prev) => prev.map((r, i) => {
        const t = now - startedAt - i * stagger
        if (t <= 0) return { ...r, phase: 'idle', pct: 0, count: 0 }
        const raw = Math.min(200, t / perStep)
        const phase: ScanRow['phase'] = raw >= 200 ? 'done' : raw >= 100 ? 'classify' : 'read'
        const count = phase === 'done' ? 100 : Math.round(raw <= 100 ? raw : raw - 100)
        return { ...r, phase, pct: Math.round(raw <= 100 ? raw : raw - 100), count }
      }))
      if (now - startedAt > totalMs && !done) { done = true; clearInterval(id); setTimeout(onDone, 600) }
    }, 60)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const tally = rows.reduce((a, r) => a + r.count, 0)
  return (
    <div className="step">
      <div className="omk"><Mark /></div>
      <h2>Reading your market…</h2>
      <div className="sub">earwise is reading what people are talking about right now.</div>
      <div className="scanning">
        {rows.map((r) => (
          <div className={`scanrow${r.phase === 'done' ? ' done' : ''}`} key={r.name}>
            <div className={`sp${r.phase === 'done' ? ' done' : r.phase === 'idle' ? ' idle' : ''}`}>{r.phase === 'done' ? '✓' : ''}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="nm">r/{r.name}</div>
              <div className="pbar"><i style={{ width: `${r.phase === 'read' ? r.pct / 2 : r.phase === 'idle' ? 0 : 50 + r.pct / 2}%` }} /></div>
            </div>
            <div className="ct">{r.phase === 'idle' ? 'queued' : r.phase === 'read' ? `reading ${r.count}/100` : r.phase === 'classify' ? `classifying ${r.count}/100` : '100 read'}</div>
          </div>
        ))}
      </div>
      <div className="scan-tally">{tally} posts processed{tally > 0 ? ' · finding demand' : ''}</div>
    </div>
  )
}

function StepReveal({ onGo }: { onGo: () => void }) {
  const [opp, setOpp] = useState<MaterializedOpportunity | null | undefined>(undefined)
  const [score, setScore] = useState(0)

  useEffect(() => {
    let cancelled = false
    fetch('/api/opportunities').then((r) => (r.ok ? r.json() : null)).catch(() => null)
      .then((j: { opportunities?: MaterializedOpportunity[] } | null) => { if (!cancelled) setOpp(j?.opportunities?.[0] ?? null) })
    return () => { cancelled = true }
  }, [])

  const target = opp ? Math.round((opp.advantage || 0) * 100) : 0
  useEffect(() => {
    if (!opp) return
    const start = Date.now()
    const id = setInterval(() => {
      const p = Math.min(1, (Date.now() - start) / 900)
      setScore(Math.round((1 - Math.pow(1 - p, 3)) * target))
      if (p >= 1) clearInterval(id)
    }, 40)
    return () => clearInterval(id)
  }, [opp, target])

  return (
    <div className="step">
      <div className="reveal">
        <div className="tag">✦ Your market&apos;s strongest demand right now</div>
        {opp === undefined ? (
          <div className="db-loading" style={{ justifyContent: 'center' }}><span className="spin" /> Ranking what your market wants…</div>
        ) : opp ? (
          <div className="hero-opp">
            <div className="htop">
              <div className="score"><b className="countup">{score}</b><span>SCORE</span></div>
              <div>
                <h3>{titleCase(opp.topic)}</h3>
                <div className="mt">{opp.posts} post{opp.posts === 1 ? '' : 's'} · across {(opp.subreddits ?? []).slice(0, 3).map((s) => `r/${s}`).join(' ')} · {trendOf(opp.momentum)}</div>
                <div className="in">A clear, recurring demand across your sources — and an opening you can win.</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="hero-opp"><div className="htop"><div><h3>Your sources are live</h3><div className="in">We&apos;re reading your market. Fresh demand and warm buyers will land on your Today list as the scan finishes.</div></div></div></div>
        )}
        <div className="cta">
          <button type="button" className="obtn" onClick={onGo}>See today&apos;s moves →</button>
          <div className="line">That took about a minute. This is what earwise finds every day.</div>
        </div>
      </div>
    </div>
  )
}
