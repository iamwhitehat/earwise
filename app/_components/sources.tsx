'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useScanCtx, useWatchlistCtx } from './scan-provider'
import { useSubSuggestions } from '@/lib/use-sub-suggestions'
import type { Project } from '@/lib/projects'

// Earwise — Sources / Scan settings (handoff Sources.html). What Earwise scans:
// your niche (drives relevance), the subreddits (the real watchlist that the scan
// runs against), keywords to watch, and how often. Wired to the watchlist context,
// /api/projects (niche), /api/suggest-subs, and the scan engine. Keywords + cadence
// persist client-side (the cron cadence itself is fixed server-side for now).
const KW_LS = 'earwise.keywords.v1'
const FREQ_LS = 'earwise.frequency.v1'
type Toast = { id: number; kind: string; msg: string }

export function Sources() {
  const scan = useScanCtx()
  const { watchlist, addSubreddit, removeSubreddit } = useWatchlistCtx()
  const { suggestions, loading: suggesting, suggest } = useSubSuggestions()

  const [niche, setNiche] = useState('')
  const [savedNiche, setSavedNiche] = useState('')
  const [keywords, setKeywords] = useState<string[]>([])
  const [freq, setFreq] = useState<'manual' | 'daily' | '6h'>('daily')
  const subInput = useRef<HTMLInputElement>(null)
  const kwInput = useRef<HTMLInputElement>(null)

  const [toasts, setToasts] = useState<Toast[]>([])
  const toastId = useRef(0)
  const push = useCallback((kind: string, msg: string) => {
    const id = ++toastId.current
    setToasts((t) => [...t, { id, kind, msg }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000)
  }, [])

  useEffect(() => {
    fetch('/api/projects')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((j: { projects?: Project[]; active?: string } | null) => {
        const active = j?.projects?.find((p) => p.id === j.active) ?? j?.projects?.[0]
        setNiche(active?.niche ?? '')
        setSavedNiche(active?.niche ?? '')
      })
    try {
      const k = JSON.parse(localStorage.getItem(KW_LS) || '[]')
      if (Array.isArray(k)) setKeywords(k.filter((x): x is string => typeof x === 'string'))
      const f = localStorage.getItem(FREQ_LS)
      if (f === 'manual' || f === 'daily' || f === '6h') setFreq(f)
    } catch { /* storage unavailable */ }
  }, [])

  function persistKw(next: string[]) {
    setKeywords(next)
    try { localStorage.setItem(KW_LS, JSON.stringify(next)) } catch { /* ignore */ }
  }
  function addSub(raw: string) {
    const err = addSubreddit(raw)
    if (err) push('⚠', err)
  }
  function addKw(raw: string) {
    const v = raw.trim()
    if (!v || keywords.some((k) => k.toLowerCase() === v.toLowerCase())) return
    persistKw([...keywords, v])
  }
  async function saveNiche() {
    const v = niche.trim()
    try {
      const r = await fetch('/api/projects', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ niche: v }) })
      if (r.ok) { setSavedNiche(v); push('✓ saved', 'Niche saved — it sharpens who reaches your leads') }
    } catch { push('⚠', "Couldn't save niche") }
  }
  function setFrequency(f: 'manual' | 'daily' | '6h') {
    setFreq(f)
    try { localStorage.setItem(FREQ_LS, f) } catch { /* ignore */ }
  }
  function scanNow() {
    if (scan.anyStreaming || watchlist.length === 0) return
    scan.scanAll()
    push('scan', `Scanning ${watchlist.length} subreddit${watchlist.length === 1 ? '' : 's'}…`)
  }

  const fresh = suggestions?.filter((s) => !watchlist.some((w) => w.toLowerCase() === s.toLowerCase())) ?? []

  return (
    <div className="ew">
      <div className="main-wrap">
        <div className="mh"><span className="bdg">Listen</span><h1>Scan settings</h1></div>
        <div className="msub">What earwise reads — your niche, the subreddits, and how often.</div>

        <div className="src-sec">
          <div className="src-h"><span>Your niche</span>{niche.trim() !== savedNiche && <button className="suggest-btn" onClick={saveNiche}>Save niche</button>}</div>
          <input
            className="chip-add"
            style={{ width: '100%', minWidth: 0 }}
            value={niche}
            placeholder="e.g. an MSP/IT-support tool for small managed service providers"
            onChange={(e) => setNiche(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') saveNiche() }}
          />
        </div>

        <div className="src-divider" />

        <div className="src-sec">
          <div className="src-h">
            <span>Subreddits ({watchlist.length})</span>
            <button className="suggest-btn" disabled={suggesting || !savedNiche} onClick={() => savedNiche && suggest(savedNiche)}>
              {suggesting ? 'Suggesting…' : '✨ Suggest more'}
            </button>
          </div>
          <div className="chips">
            {watchlist.map((s) => (
              <span className="chip-sr" key={s}>r/{s}<span className="chip-x" onClick={() => removeSubreddit(s)}>✕</span></span>
            ))}
            {fresh.map((s) => (
              <button className="chip-suggest" key={s} onClick={() => addSub(s)}>+ r/{s}</button>
            ))}
            <input
              ref={subInput}
              className="chip-add"
              placeholder="r/ add a subreddit and press enter…"
              onKeyDown={(e) => { if (e.key === 'Enter') { addSub(e.currentTarget.value); e.currentTarget.value = '' } }}
            />
          </div>
        </div>

        <div className="src-sec">
          <div className="src-h"><span>Watch for</span></div>
          <div className="chips">
            {keywords.map((k) => (
              <span className="chip-kw" key={k}>{k}<span className="chip-x" onClick={() => persistKw(keywords.filter((x) => x !== k))}>✕</span></span>
            ))}
            <input
              ref={kwInput}
              className="chip-add"
              placeholder="add a keyword and press enter…"
              onKeyDown={(e) => { if (e.key === 'Enter') { addKw(e.currentTarget.value); e.currentTarget.value = '' } }}
            />
          </div>
        </div>

        <div className="src-divider" />

        <div className="src-foot">
          <div className="freq">
            {(['manual', 'daily', '6h'] as const).map((v) => (
              <button key={v} className={freq === v ? 'on' : ''} onClick={() => setFrequency(v)}>{v === 'manual' ? 'Manual' : v === 'daily' ? 'Daily' : '6h'}</button>
            ))}
          </div>
          <button className={`scannow${scan.anyStreaming ? ' spinning' : ''}`} disabled={watchlist.length === 0} onClick={scanNow}>
            <span>⟳</span>{scan.anyStreaming ? 'Scanning…' : 'Scan now'}
          </button>
        </div>
      </div>

      <div className="toast-wrap">
        {toasts.map((t) => <div className="toast" key={t.id}><span className="ti">{t.kind}</span><span>{t.msg}</span></div>)}
      </div>
    </div>
  )
}
