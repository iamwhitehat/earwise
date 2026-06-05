'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { promoGate } from '@/lib/warm-leads'
import type { Lead } from '@/lib/leads'

// Earwise — Drafts (handoff Drafts.html). Decide WHAT you'll say and ship it
// safely. A "draft" is a lead that already has an opener (openerDraft) and hasn't
// been published (status 'new'); grouped by the promo gate — "Ready to publish"
// first, then "Needs a look" (flagged: reads like an ad → must be edited & re-passed
// before publishing). Publish is irreversible → explicit confirm; Reddit posting
// can't be automated, so we copy + open the thread.
const JSON_HEADERS = { 'content-type': 'application/json' }
type Toast = { id: number; kind: string; msg: string }
type DraftRow = { l: Lead; state: 'ready' | 'needs_look'; reason?: string }

export function Drafts() {
  const [leads, setLeads] = useState<Lead[] | null>(null)
  const [editing, setEditing] = useState<number | null>(null)
  const [editText, setEditText] = useState('')
  const [confirm, setConfirm] = useState<Lead | null>(null)

  const [toasts, setToasts] = useState<Toast[]>([])
  const toastId = useRef(0)
  const push = useCallback((kind: string, msg: string) => {
    const id = ++toastId.current
    setToasts((t) => [...t, { id, kind, msg }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3400)
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch('/api/leads')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((j: { leads?: Lead[] } | null) => {
        if (cancelled) return
        setLeads((j?.leads ?? []).filter((l) => l.openerDraft && l.status === 'new'))
      })
    return () => { cancelled = true }
  }, [])

  const drafts: DraftRow[] = useMemo(() => {
    return (leads ?? []).map((l) => {
      const gate = promoGate(l.openerDraft)
      return { l, state: gate.flag ? 'needs_look' : 'ready', reason: gate.reason }
    })
  }, [leads])
  const ready = drafts.filter((d) => d.state === 'ready')
  const needsLook = drafts.filter((d) => d.state === 'needs_look')

  async function patch(id: number, body: Record<string, unknown>): Promise<Lead | null> {
    try {
      const r = await fetch(`/api/leads/${id}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(body) })
      return r.ok ? ((await r.json()) as { lead: Lead }).lead : null
    } catch {
      return null
    }
  }

  function startEdit(l: Lead) { setEditing(l.id); setEditText(l.openerDraft ?? '') }
  async function saveEdit(l: Lead) {
    const updated = await patch(l.id, { openerDraft: editText })
    if (updated) setLeads((prev) => (prev ?? []).map((x) => (x.id === l.id ? updated : x)))
    setEditing(null)
    const gate = promoGate(editText)
    push(gate.flag ? '⚠ flagged' : '✓ saved', gate.flag ? `Still flagged: ${gate.reason}` : 'Re-checked — ready to publish')
  }
  async function discard(l: Lead) {
    setLeads((prev) => (prev ?? []).filter((x) => x.id !== l.id))
    await patch(l.id, { status: 'passed' })
    push('deleted', 'Draft discarded')
  }
  async function publish(l: Lead) {
    try { await navigator.clipboard.writeText(l.openerDraft ?? '') } catch { /* clipboard denied */ }
    window.open(l.permalink, '_blank', 'noopener,noreferrer')
    setLeads((prev) => (prev ?? []).filter((x) => x.id !== l.id))
    setConfirm(null)
    await patch(l.id, { status: 'contacted' })
    push('⧉ copied', `Draft copied · opening u/${l.author}'s thread — paste to reply`)
  }

  function Card({ d }: { d: DraftRow }) {
    const { l, state, reason } = d
    const isEditing = editing === l.id
    return (
      <div className={`dft${state === 'needs_look' ? ' flag' : ''}`}>
        <div className="dtop">
          <span className="tbadge reply">↩ Reply</span>
          <span className="dtarget">→ r/{l.subreddit} · re: u/{l.author}</span>
          <span className={`spill ${state === 'ready' ? 'ready' : 'needs'}`}>
            {state === 'needs_look' ? `⚠ ${reason || 'needs a look'}` : 'ready'}
          </span>
        </div>

        {isEditing
          ? <textarea value={editText} onChange={(e) => setEditText(e.target.value)} autoFocus />
          : <div className="dpreview">{l.openerDraft}</div>}

        <div className="dacts">
          <button type="button" className="discardbtn" onClick={() => discard(l)} title="Delete draft">🗑 Discard</button>
          {!isEditing && state === 'needs_look' && <span className="reason">Edit to clear the flag before publishing</span>}
          {isEditing ? (
            <>
              <button type="button" className="editbtn" onClick={() => setEditing(null)}>Cancel</button>
              <button type="button" className="pubbtn" onClick={() => saveEdit(l)}>Save &amp; re-check</button>
            </>
          ) : (
            <>
              <button type="button" className="editbtn" onClick={() => startEdit(l)}>✎ Edit</button>
              <button type="button" className="pubbtn" disabled={state !== 'ready'} onClick={() => setConfirm(l)}>Publish →</button>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="ew">
      <div className="main-wrap">
        <div className="mh">
          <span className="bdg">Distribute</span>
          <h1>Drafts</h1>
          {drafts.length > 0 && <span className="count">{drafts.length} draft{drafts.length === 1 ? '' : 's'} · {ready.length} ready</span>}
        </div>
        <div className="msub">Generated and waiting. Edit, then publish.</div>

        {leads === null ? (
          <div className="db-loading"><span className="spin" /> Loading drafts…</div>
        ) : drafts.length === 0 ? (
          <div className="zero">
            <div className="zmk">✎</div>
            <h3>No drafts yet</h3>
            <p>Draft a reply from a warm lead and it lands here — edited, gated, and ready to publish.</p>
            <div className="act"><Link className="zp" href="/warm-leads">Go to Warm leads →</Link></div>
          </div>
        ) : (
          <>
            {ready.length > 0 && <div className="sectlabel">Ready to publish</div>}
            {ready.map((d) => <Card key={d.l.id} d={d} />)}
            {needsLook.length > 0 && <div className="sectlabel">Needs a look</div>}
            {needsLook.map((d) => <Card key={d.l.id} d={d} />)}
          </>
        )}
      </div>

      <div className="toast-wrap">
        {toasts.map((t) => <div className="toast" key={t.id}><span className="ti">{t.kind}</span><span>{t.msg}</span></div>)}
      </div>

      {confirm && (
        <div className="modal-bg" onClick={() => setConfirm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h4>Publish to Reddit?</h4>
            <div className="msg">earwise copies your draft and opens the thread — paste it into Reddit to post. (Reddit posting can&apos;t be automated.)</div>
            <div className="tgt">Reply to u/{confirm.author}&apos;s thread in r/{confirm.subreddit}</div>
            <div className="confirm-actions">
              <button type="button" className="ok" onClick={() => publish(confirm)}>Copy &amp; open thread →</button>
              <button type="button" className="no" onClick={() => setConfirm(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
