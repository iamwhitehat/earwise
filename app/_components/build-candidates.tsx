'use client'

import { useCallback, useEffect, useState } from 'react'
import { useWatchlistCtx } from './scan-provider'

// Build candidates — the private demand-finder's payoff screen. Reads
// /api/sources/themes (one Haiku pass clustering signal topics into ranked
// "what to build" themes) and a Re-scan button that ingests the watchlist subs
// (year-deep demand search) then refreshes. The whole loop, no curl.
type Theme = { theme: string; pain: string; toolIdea: string; demand?: number; topics?: string[] }
type ThemesResponse = { totalTopics?: number; totalSignals?: number; themes?: Theme[]; error?: string }
const JSON_HEADERS = { 'content-type': 'application/json' }

export function BuildCandidates() {
  const { watchlist } = useWatchlistCtx()
  const [themes, setThemes] = useState<Theme[] | null>(null)
  const [signals, setSignals] = useState(0)
  const [scanning, setScanning] = useState(false)
  const [err, setErr] = useState('')

  const loadThemes = useCallback(async () => {
    setErr('')
    try {
      const r = await fetch('/api/sources/themes?source=reddit')
      const j = (await r.json()) as ThemesResponse
      if (!r.ok) throw new Error(j.error ?? 'Failed to read demand')
      setThemes([...(j.themes ?? [])].sort((a, b) => (b.demand ?? 0) - (a.demand ?? 0)))
      setSignals(j.totalSignals ?? 0)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to read demand')
      setThemes([])
    }
  }, [])
  useEffect(() => { loadThemes() }, [loadThemes])

  async function rescan() {
    if (scanning || watchlist.length === 0) return
    setScanning(true)
    setErr('')
    try {
      await fetch('/api/sources/ingest', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ reddit: watchlist }) })
      await loadThemes()
    } catch {
      setErr('Scan failed — try again.')
    } finally {
      setScanning(false)
    }
  }

  return (
    <div className="ew">
      <div className="main-wrap">
        <div className="bc-head">
          <div>
            <div className="greet-h">Build candidates</div>
            <div className="greet-sub">
              Ranked unmet demand from your watchlist{signals > 0 ? ` · ${signals} signals` : ''}. Re-scan to pull fresh demand.
            </div>
          </div>
          <button type="button" className={`bc-scan${scanning ? ' on' : ''}`} onClick={rescan} disabled={scanning || watchlist.length === 0}>
            {scanning ? 'Scanning…' : '↻ Re-scan'}
          </button>
        </div>

        {err && <div className="bc-err">{err}</div>}

        {themes === null ? (
          <div className="db-loading"><span className="spin" /> Reading demand…</div>
        ) : themes.length === 0 ? (
          <div className="bc-empty">
            No candidates yet.{watchlist.length === 0 ? ' Add subs in Sources first, then' : ''} hit <b>Re-scan</b> to pull demand from your watchlist.
          </div>
        ) : (
          themes.map((t, i) => (
            <div className="bc-card" key={`${t.theme}-${i}`}>
              <div className="bc-rank">{i + 1}</div>
              <div className="bc-body">
                <div className="bc-top">
                  <b>{t.theme}</b>
                  {typeof t.demand === 'number' && <span className="bc-dem">demand {t.demand}</span>}
                </div>
                <div className="bc-pain">{t.pain}</div>
                <div className="bc-build"><span className="bc-lbl">BUILD</span>{t.toolIdea}</div>
              </div>
            </div>
          ))
        )}

        {scanning && <div className="bc-note">Reading a year of demand across {watchlist.length} subs + reclustering… ~30s.</div>}
      </div>
    </div>
  )
}
