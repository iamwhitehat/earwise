'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useScanCtx } from './scan-provider'
import { heatOf, ageStr, promoGate, HEAT_GLYPH, type Heat } from '@/lib/warm-leads'
import { leadExternalId, type Lead } from '@/lib/leads'
import { canonicalTopic } from '@/lib/topics'
import type { HotSignal } from '@/lib/hot-signals'

// Earwise — Warm Leads (handoff WarmLeads.html), recreated for Next and wired to
// the real engine. Decide WHO to reach today, zero manual triage: hottest on top
// (our /api/hot-signals score = warmth), cool ones greyed. One action: "Draft
// reply →" (creates the lead + generates the opener in your voice → pipeline).
// Cold leads offer Archive (mark the lead passed). A promo gate flags spammy drafts.
const FILTERS: Array<'All' | 'Hot' | 'Cooling' | 'Cold'> = ['All', 'Hot', 'Cooling', 'Cold']
const JSON_HEADERS = { 'content-type': 'application/json' }

type Local = 'drafting' | 'drafted' | 'archived'
type Toast = { id: number; kind: string; msg: string }

export function WarmLeads() {
  const scan = useScanCtx()
  const params = useSearchParams()
  const opp = params.get('opp')

  const [signals, setSignals] = useState<HotSignal[] | null>(null)
  const [needsNiche, setNeedsNiche] = useState(false)
  const [leadMap, setLeadMap] = useState<Map<string, Lead>>(new Map())
  const [local, setLocal] = useState<Map<string, Local>>(new Map())
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('All')

  // toasts
  const [toasts, setToasts] = useState<Toast[]>([])
  const toastId = useRef(0)
  const push = useCallback((kind: string, msg: string) => {
    const id = ++toastId.current
    setToasts((t) => [...t, { id, kind, msg }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3400)
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch('/api/hot-signals?window=24h').then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch('/api/leads').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([hot, leads]) => {
      if (cancelled) return
      setSignals((hot as { signals?: HotSignal[] } | null)?.signals ?? [])
      setNeedsNiche((hot as { needsNiche?: boolean } | null)?.needsNiche ?? false)
      const m = new Map<string, Lead>()
      for (const l of (leads as { leads?: Lead[] } | null)?.leads ?? []) {
        if (l.externalId) m.set(l.externalId, l)
      }
      setLeadMap(m)
    })
    return () => { cancelled = true }
  }, [])

  const rows = useMemo(() => {
    if (signals === null) return null
    const oppCanon = opp ? canonicalTopic(opp.replace(/-/g, ' ')) : null
    return signals
      .map((s) => {
        const ext = leadExternalId(s.kind, s.id)
        const lead = leadMap.get(ext)
        const loc = local.get(s.id)
        return {
          s,
          heat: heatOf(s.score),
          archived: loc === 'archived' || lead?.status === 'passed',
          drafted: loc === 'drafted' || !!lead?.openerDraft,
          drafting: loc === 'drafting',
        }
      })
      .filter((r) => !r.archived)
      .filter((r) => (oppCanon ? canonicalTopic(r.s.topic) === oppCanon : true))
      .sort((a, b) => b.s.score - a.s.score)
  }, [signals, leadMap, local, opp])

  const hot = rows?.filter((r) => r.heat === 'hot').length ?? 0
  const cooling = rows?.filter((r) => r.heat === 'cooling').length ?? 0
  const shown = rows && (filter === 'All' ? rows : rows.filter((r) => r.heat === (filter.toLowerCase() as Heat)))
  const clusterTitle = opp ? (rows?.[0]?.s.topic || opp.replace(/-/g, ' ')) : null

  const signalBody = (s: HotSignal) => ({
    kind: s.kind, id: s.id, post_id: s.post_id, subreddit: s.subreddit, permalink: s.permalink,
    author: s.author, topic: s.topic, intentType: s.intentType, category: s.category, text: s.text,
  })

  // Draft reply → create the lead (idempotent) + generate the opener in your voice,
  // run the promo gate, mark drafted (it now lives in the pipeline / Drafts).
  async function draftReply(s: HotSignal) {
    setLocal((m) => new Map(m).set(s.id, 'drafting'))
    try {
      const lr = await fetch('/api/leads', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(signalBody(s)) })
      const lj = (await lr.json()) as { lead?: { id?: number; openerDraft?: string | null }; error?: string }
      if (!lr.ok) throw new Error(lj.error ?? `Error ${lr.status}`)
      let opener = lj.lead?.openerDraft ?? ''
      if (lj.lead?.id && !opener) {
        const or = await fetch(`/api/leads/${lj.lead.id}/opener`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ action: 'generate' }) })
        const oj = (await or.json()) as { opener?: string; error?: string }
        if (!or.ok) throw new Error(oj.error ?? `Error ${or.status}`)
        opener = oj.opener ?? ''
      }
      const gate = promoGate(opener)
      setLocal((m) => new Map(m).set(s.id, 'drafted'))
      push('drafted', gate.flag ? `Draft ready — flagged: ${gate.reason}. Take a look.` : `Drafted u/${s.author} — it's in your pipeline`)
    } catch (e) {
      setLocal((m) => { const n = new Map(m); n.delete(s.id); return n })
      push('error', e instanceof Error ? e.message : 'Draft failed')
    }
  }

  // Archive a cold lead → create + mark passed so it won't resurface or waste a reply.
  async function archive(s: HotSignal) {
    setLocal((m) => new Map(m).set(s.id, 'archived'))
    try {
      const lr = await fetch('/api/leads', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(signalBody(s)) })
      const lj = (await lr.json()) as { lead?: { id?: number } }
      if (lj.lead?.id) {
        await fetch(`/api/leads/${lj.lead.id}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ status: 'passed' }) })
      }
      push('archived', `u/${s.author} archived — won't waste a reply`)
    } catch {
      /* optimistic removal stands */
    }
  }

  function runScan() {
    scan.scanAll()
    push('scan', 'Reading your sources for fresh demand…')
  }

  return (
    <div className="ew">
      <div className="main-wrap">
        <div className="mh">
          <span className="bdg">Distribute</span>
          <h1>Warm leads</h1>
          {rows && rows.length > 0 && <span className="count">{hot} warm · {cooling} cooling</span>}
        </div>
        <div className="msub">Sorted by heat. Reply before they cool.</div>

        {opp && (
          <div className="cluster-banner">
            <span>Showing cluster · <b>{clusterTitle}</b></span>
            <Link href="/warm-leads">✕ clear filter</Link>
          </div>
        )}

        <div className="filter-pills">
          {FILTERS.map((f) => (
            <button key={f} type="button" className={`filt${filter === f ? ' on' : ''}`} onClick={() => setFilter(f)}>{f}</button>
          ))}
        </div>

        {rows === null ? (
          <div className="db-loading"><span className="ew-spin" /> Reading warm leads…</div>
        ) : shown && shown.length === 0 ? (
          <div className="zero">
            <div className="zmk">⚡</div>
            <h3>{needsNiche ? 'Set your niche to see buyers' : filter === 'All' ? 'No warm leads right now' : `Nothing ${filter.toLowerCase()}`}</h3>
            <p>
              {needsNiche
                ? "Tell earwise what you sell and who you sell to — then we can tell a real buyer from noise."
                : filter === 'All'
                  ? 'Your queue is clear. Run a scan to surface fresh high-intent posts.'
                  : 'Try another filter, or run a scan for fresh signal.'}
            </p>
            <div className="act">
              {needsNiche
                ? <Link className="zp" href="/settings">Set your niche</Link>
                : <button type="button" className="zp" onClick={runScan}>⟳ Scan for new</button>}
            </div>
          </div>
        ) : (
          shown!.map(({ s, heat, drafted, drafting }) => {
            const excerpt = s.text.replace(/\s+/g, ' ').trim().slice(0, 200)
            return (
              <div className={`wl ${heat}${drafted ? ' drafted' : ''}`} key={s.id}>
                <span className="strip" />
                <span className="heat">{HEAT_GLYPH[heat]}</span>
                <div className="wbody">
                  <div className="wtop">
                    <span className="who">u/{s.author}</span>
                    <span className="wmeta">r/{s.subreddit} · {s.score} · {ageStr(s.postedAt ?? s.analyzedAt)}</span>
                    <span className={`wpill ${heat}`}>{heat}</span>
                  </div>
                  <div className="quote">&ldquo;{excerpt}&rdquo;</div>
                </div>
                <div className="wact">
                  {drafted ? (
                    <Link className="drafted-tag" href="/pipeline">✓ drafted · open →</Link>
                  ) : heat === 'cold' ? (
                    <button type="button" className="archbtn" onClick={() => archive(s)}>Archive</button>
                  ) : (
                    <button type="button" className="draftbtn" disabled={drafting} onClick={() => draftReply(s)}>
                      {drafting ? <><span className="ew-spin" /> Drafting…</> : 'Draft reply →'}
                    </button>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      <div className="toast-wrap">
        {toasts.map((t) => (
          <div className="toast" key={t.id}>
            <span className="ti">{t.kind}</span>
            <span>{t.msg}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
