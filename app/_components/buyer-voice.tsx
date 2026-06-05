'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  filterLangItems,
  collectSubreddits,
  type BuyerLanguageData,
  type LangItem,
} from './components'

// Earwise — Demand · Buyer Voice (handoff BuyerVoice.html / spec §6.4). The exact
// words buyers use — powers every draft and doubles as a swipe file. Three
// frequency-counted chip sections from /api/buyer-language; optional subreddit
// filter (reuses our filterLangItems/collectSubreddits); copy-chip + copy-all.
type Toast = { id: number; kind: string; msg: string }
const SECTION_META = [
  { id: 'phrases', label: 'Common phrases', cls: '' },
  { id: 'tools', label: 'Tools mentioned', cls: 'tool' },
  { id: 'emotion', label: 'Emotional language', cls: 'emo' },
] as const

export function BuyerVoice() {
  const [data, setData] = useState<BuyerLanguageData | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [filter, setFilter] = useState('all')
  const [copied, setCopied] = useState<string | null>(null)

  const [toasts, setToasts] = useState<Toast[]>([])
  const toastId = useRef(0)
  const push = useCallback((kind: string, msg: string) => {
    const id = ++toastId.current
    setToasts((t) => [...t, { id, kind, msg }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200)
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch('/api/buyer-language')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((j: BuyerLanguageData | null) => { if (!cancelled) { setData(j); setLoaded(true) } })
    return () => { cancelled = true }
  }, [])

  async function refresh() {
    if (refreshing) return
    setRefreshing(true)
    push('⟳ reading', 'Mining your scanned posts for buyer language…')
    try {
      const r = await fetch('/api/buyer-language/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      if (r.ok) setData((await r.json()) as BuyerLanguageData)
    } catch { /* non-fatal */ } finally { setRefreshing(false) }
  }

  const subs = useMemo(() => (data ? ['all', ...collectSubreddits(data)] : ['all']), [data])
  const sectionItems = useCallback(
    (id: string): LangItem[] => {
      if (!data) return []
      const raw = id === 'tools' ? data.tools : id === 'emotion' ? data.emotional : data.phrases
      return filterLangItems(raw, filter, 'all')
    },
    [data, filter],
  )

  function copyChip(t: string) {
    void navigator.clipboard?.writeText(t).catch(() => {})
    push('⧉ copied', `"${t}" — drop it into a draft`)
  }
  function copyAll(id: string, label: string) {
    const list = sectionItems(id).map((i) => i.text).join(', ')
    void navigator.clipboard?.writeText(list).catch(() => {})
    setCopied(id)
    push('⧉ copied', `All ${label.toLowerCase()} copied`)
    setTimeout(() => setCopied(null), 1800)
  }

  const empty = loaded && (!data || data.phrases.length + data.tools.length + data.emotional.length === 0)

  return (
    <div className="ew">
      <div className="main-wrap">
        <div className="mh"><span className="bdg">Demand</span><h1>How your buyers talk</h1></div>
        <div className="msub">Their exact words — drop them into posts, ads, cold emails.</div>

        {!loaded ? (
          <div className="db-loading"><span className="spin" /> Loading buyer language…</div>
        ) : empty ? (
          <div className="zero">
            <div className="zmk">❝</div>
            <h3>No buyer language yet</h3>
            <p>Scan your sources, then distil the recurring phrases, tools, and emotional words your buyers use.</p>
            <div className="act"><button type="button" className="zp" onClick={refresh} disabled={refreshing}>{refreshing ? 'Reading…' : '⟳ Distil buyer language'}</button></div>
          </div>
        ) : (
          <>
            {subs.length > 1 && (
              <div className="bv-filter">
                {subs.map((s) => (
                  <button key={s} type="button" className={`fchip${filter === s ? ' on' : ''}`} onClick={() => setFilter(s)}>
                    {s === 'all' ? 'all sources' : `r/${s}`}
                  </button>
                ))}
              </div>
            )}

            {SECTION_META.map((sec) => {
              const items = sectionItems(sec.id)
              return (
                <div className="bv-sec" key={sec.id}>
                  <div className="bv-h">
                    <span className="lbl">{sec.label}</span>
                    {items.length > 0 && (
                      <button type="button" className={`copy${copied === sec.id ? ' done' : ''}`} onClick={() => copyAll(sec.id, sec.label)}>
                        {copied === sec.id ? '✓ copied' : '⧉ copy all'}
                      </button>
                    )}
                  </div>
                  {items.length > 0 ? (
                    <div className="bv-chips">
                      {items.map((i) => (
                        <button key={i.text} type="button" className={`c ${sec.cls}`} onClick={() => copyChip(i.text)}>
                          {i.text}<b>{i.count}</b>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="kempty" style={{ maxWidth: 280 }}>— none from r/{filter} yet —</div>
                  )}
                </div>
              )
            })}
          </>
        )}
      </div>

      <div className="toast-wrap">
        {toasts.map((t) => <div className="toast" key={t.id}><span className="ti">{t.kind}</span><span>{t.msg}</span></div>)}
      </div>
    </div>
  )
}
