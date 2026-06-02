'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { SubChip, CategoryBadge, LeadScoreBadge, HotNowLane, FunnelStrip, WhatsWorkingPanel } from './components'
import { snippetWithHighlight, formatAge } from './signal-card'
import { Icons, Spinner } from './icons'
import { findFirstMatch } from '@/lib/intent-patterns'
import {
  LEAD_STATUSES,
  LEAD_STATUS_LABEL,
  emptyStatusCounts,
  type Lead,
  type LeadStatus,
} from '@/lib/leads'
import {
  dueFollowUps,
  suggestedNextStep,
  SEQUENCE_STEP_LABEL,
  type SequenceStep,
} from '@/lib/follow-ups'
import { type LeadMessage, type MessageKind } from '@/lib/lead-messages'
import type { ObjectionEntry } from '@/lib/objections'
import type { Category } from '@/lib/categories'

const TOP_SIGNALS_TO_ADD = 15

export function LeadsBoard() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [addNote, setAddNote] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/leads')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`)
      setLeads((json as { leads: Lead[] }).leads)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load leads')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Counts derived from the live list so they stay correct after every local
  // mutation without a refetch.
  const counts = useMemo(() => {
    const c = emptyStatusCounts()
    for (const l of leads) c[l.status]++
    return c
  }, [leads])

  const byStatus = useMemo(() => {
    const map: Record<LeadStatus, Lead[]> = {
      new: [], contacted: [], replied: [], call: [], customer: [], passed: [],
    }
    for (const l of leads) map[l.status].push(l)
    return map
  }, [leads])

  // Replace one lead in place (used by status / notes / opener mutations).
  const patchLead = useCallback((updated: Lead) => {
    setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)))
  }, [])

  const removeLead = useCallback((id: number) => {
    setLeads((prev) => prev.filter((l) => l.id !== id))
  }, [])

  async function addTopSignals() {
    if (adding) return
    setAdding(true)
    setAddNote(null)
    setError(null)
    try {
      const sigRes = await fetch('/api/signals?age=week')
      const sigJson = await sigRes.json()
      if (!sigRes.ok) throw new Error(sigJson.error ?? `Error ${sigRes.status}`)
      const signals = (sigJson as { signals: unknown[] }).signals ?? []
      if (signals.length === 0) {
        setAddNote('No high-intent signals this week. Run a scan first.')
        return
      }
      const batch = signals.slice(0, TOP_SIGNALS_TO_ADD)
      const res = await fetch('/api/leads/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ signals: batch }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`)
      const { added, skipped } = json as { added: number; skipped: number }
      setAddNote(
        added === 0
          ? `All ${skipped} top signals are already in your pipeline.`
          : `Added ${added} lead${added === 1 ? '' : 's'}${skipped ? ` · ${skipped} already present` : ''}.`,
      )
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add signals')
    } finally {
      setAdding(false)
    }
  }

  const hasLeads = leads.length > 0

  return (
    <>
      <div className="pipe-actions">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={addTopSignals}
          disabled={adding}
        >
          {adding ? (
            <>
              <Spinner size={12} /> Adding…
            </>
          ) : (
            <>
              <Icons.plus size={14} /> Add top signals
            </>
          )}
        </button>
      </div>

      <FunnelStrip />

      <HotNowLane />

        {addNote && (
          <div className="card fade-in leads-note">{addNote}</div>
        )}

        {error && (
          <div
            className="card"
            style={{
              padding: '14px 17px',
              marginBottom: 'var(--gap)',
              background: 'var(--pain-bg)',
              borderColor: 'oklch(0.9 0.05 22)',
              color: 'var(--ink-2)',
              fontSize: 13,
            }}
          >
            <strong style={{ color: 'var(--pain)' }}>Error:</strong> {error}
          </div>
        )}

        {loading && (
          <div className="empty" style={{ padding: 40 }}>
            <Spinner size={18} color="var(--ink-3)" /> Loading pipeline…
          </div>
        )}

        {!loading && !error && !hasLeads && (
          <div className="card empty fade-in">
            <span className="e-ico">
              <Icons.inbox size={26} />
            </span>
            <div style={{ marginBottom: 14 }}>
              Your pipeline is empty. Pull this week&apos;s highest-intent signals — people
              actively describing a problem you can solve — and start tracking them to customers.
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={addTopSignals}
              disabled={adding}
            >
              {adding ? (
                <>
                  <Spinner size={13} /> Adding…
                </>
              ) : (
                <>
                  <Icons.bolt size={14} /> Add top high-intent signals
                </>
              )}
            </button>
          </div>
        )}

        {!loading && hasLeads && <NeedsFollowUp leads={leads} onPatch={patchLead} />}

        {!loading && hasLeads && (
          <div className="leads-board scroll">
            {LEAD_STATUSES.map((status) => (
              <section className="leads-col" key={status}>
                <div className="leads-col-head">
                  <span className="leads-col-title">
                    <span className={`status-dot status-${status}`} aria-hidden="true" />
                    {LEAD_STATUS_LABEL[status]}
                  </span>
                  <span className="leads-col-count tnum">{counts[status]}</span>
                </div>
                <div className="leads-col-body">
                  {byStatus[status]
                    .filter((l) => l.tier !== 'cold')
                    .map((lead) => (
                      <LeadCard key={lead.id} lead={lead} onPatch={patchLead} onRemove={removeLead} />
                    ))}
                  {byStatus[status].length === 0 && (
                    <div className="leads-col-empty">—</div>
                  )}
                  {(() => {
                    const cold = byStatus[status].filter((l) => l.tier === 'cold')
                    if (cold.length === 0) return null
                    return (
                      <details className="leads-qualify-out">
                        <summary>
                          {cold.length} low-fit lead{cold.length === 1 ? '' : 's'}
                          <span className="qo-why">weak intent · aged · low ICP</span>
                        </summary>
                        {cold.map((lead) => (
                          <LeadCard key={lead.id} lead={lead} onPatch={patchLead} onRemove={removeLead} />
                        ))}
                      </details>
                    )
                  })()}
                </div>
              </section>
            ))}
          </div>
        )}

        <WhatsWorkingPanel />
    </>
  )
}

type OpenerState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; error: string }

function LeadCard({
  lead,
  onPatch,
  onRemove,
}: {
  lead: Lead
  onPatch: (lead: Lead) => void
  onRemove: (id: number) => void
}) {
  const [opener, setOpener] = useState<OpenerState>({ status: 'idle' })
  const [copied, setCopied] = useState(false)
  const [sent, setSent] = useState(false)
  const [notes, setNotes] = useState(lead.notes ?? '')
  const [savingNotes, setSavingNotes] = useState(false)
  const [showConvo, setShowConvo] = useState(false)

  // Highlight phrase derived from the excerpt (leads don't persist the
  // matched phrase) — reuse the signal intent-pattern matcher.
  const phrase = useMemo(
    () => findFirstMatch(lead.excerpt)?.phrase ?? '',
    [lead.excerpt],
  )

  async function changeStatus(status: LeadStatus) {
    if (status === lead.status) return
    try {
      const res = await fetch(`/api/leads/${lead.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`)
      onPatch((json as { lead: Lead }).lead)
    } catch {
      // Leave the card where it was; the select reverts on next render.
      onPatch({ ...lead })
    }
  }

  async function saveNotes() {
    if (notes === (lead.notes ?? '')) return
    setSavingNotes(true)
    try {
      const res = await fetch(`/api/leads/${lead.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ notes }),
      })
      const json = await res.json()
      if (res.ok) onPatch((json as { lead: Lead }).lead)
    } catch {
      // keep local text; user can retry
    } finally {
      setSavingNotes(false)
    }
  }

  async function generateOpener() {
    setOpener({ status: 'loading' })
    try {
      const res = await fetch(`/api/leads/${lead.id}/opener`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'generate' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`)
      onPatch((json as { lead: Lead }).lead)
      setOpener({ status: 'idle' })
    } catch (err) {
      setOpener({ status: 'error', error: err instanceof Error ? err.message : 'Failed' })
    }
  }

  async function copyOpener() {
    if (!lead.openerDraft) return
    try {
      await navigator.clipboard.writeText(lead.openerDraft)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard can fail silently (permissions / insecure context).
    }
  }

  async function markSent() {
    try {
      const res = await fetch(`/api/leads/${lead.id}/opener`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'mark-sent' }),
      })
      const json = await res.json()
      if (res.ok) {
        onPatch((json as { lead: Lead }).lead)
        setSent(true)
        setTimeout(() => setSent(false), 1500)
      }
    } catch {
      // ignore
    }
  }

  async function remove() {
    onRemove(lead.id) // optimistic
    try {
      await fetch(`/api/leads/${lead.id}`, { method: 'DELETE' })
    } catch {
      // If the delete failed the row will reappear on next full load.
    }
  }

  return (
    <article className="lead-card">
      <header className="lead-head">
        <span className="lead-author">u/{lead.author}</span>
        <SubChip sub={lead.subreddit} />
        <button
          type="button"
          className="lead-del"
          onClick={remove}
          aria-label="Remove lead"
          title="Remove from pipeline"
        >
          <Icons.x size={12} />
        </button>
      </header>

      <div className="lead-badges">
        <LeadScoreBadge score={lead.leadScore} tier={lead.tier} breakdown={lead.scoreBreakdown} />
        <CategoryBadge cat={lead.category as Category} />
        {lead.intentType && (
          <span className={`signal-intent intent-${lead.intentType}`}>{lead.intentType}</span>
        )}
        {lead.topic && (
          <span
            className="badge"
            style={{ color: 'var(--accent-text)', background: 'var(--accent-soft)' }}
          >
            {lead.topic}
          </span>
        )}
      </div>

      <p className="lead-excerpt">{snippetWithHighlight(lead.excerpt, phrase)}</p>

      {lead.openerDraft && (
        <div className="lead-opener">
          <div className="lead-opener-label">Opener · adapt before sending</div>
          <div className="lead-opener-body">{lead.openerDraft}</div>
        </div>
      )}
      {opener.status === 'error' && (
        <div className="lead-opener lead-opener-error">{opener.error}</div>
      )}

      <div className="lead-actions">
        <a className="btn btn-ghost btn-sm" href={lead.permalink} target="_blank" rel="noopener noreferrer">
          <Icons.ext size={12} /> View
        </a>
        {opener.status === 'loading' ? (
          <button type="button" className="btn btn-primary btn-sm" disabled>
            <Spinner size={11} /> Writing…
          </button>
        ) : lead.openerDraft ? (
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={generateOpener}>
              <Icons.sparkles size={12} /> Regenerate
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={copyOpener}>
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={markSent}>
              {sent ? 'Sent ✓' : 'Mark sent'}
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-primary btn-sm" onClick={generateOpener}>
            <Icons.sparkles size={12} /> Generate opener
          </button>
        )}
      </div>

      <div className="lead-foot">
        <select
          className="lead-status"
          value={lead.status}
          onChange={(e) => changeStatus(e.target.value as LeadStatus)}
          aria-label="Lead status"
        >
          {LEAD_STATUSES.map((s) => (
            <option key={s} value={s}>
              {LEAD_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <span className="lead-age">{formatAge(lead.lastEventAt)}</span>
      </div>

      <textarea
        className="lead-notes"
        placeholder="Notes…"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={saveNotes}
        rows={2}
      />
      {savingNotes && <span className="lead-notes-saving">Saving…</span>}

      <button
        type="button"
        className="lead-convo-toggle"
        onClick={() => setShowConvo((s) => !s)}
        aria-expanded={showConvo}
      >
        <Icons.chat size={12} /> {showConvo ? 'Hide conversation' : 'Conversation'}
      </button>
      {showConvo && <LeadConversation lead={lead} onPatch={onPatch} />}
    </article>
  )
}

// ─── Needs-follow-up queue (Convert #3) ──────────────────────────────────────

function NeedsFollowUp({ leads, onPatch }: { leads: Lead[]; onPatch: (lead: Lead) => void }) {
  const [drafting, setDrafting] = useState<number | null>(null)
  const due = useMemo(() => dueFollowUps(leads), [leads])
  if (due.length === 0) return null

  async function draft(lead: Lead) {
    setDrafting(lead.id)
    try {
      const res = await fetch(`/api/leads/${lead.id}/follow-up`, { method: 'POST' })
      const json = await res.json()
      if (res.ok && (json as { lead?: Lead }).lead) onPatch((json as { lead: Lead }).lead)
    } catch {
      /* leave in queue to retry */
    } finally {
      setDrafting(null)
    }
  }

  return (
    <section className="section needs-followup">
      <div className="section-head">
        <h2>Needs follow-up</h2>
        <span className="pill">{due.length} waiting</span>
        <span className="hint">contacted, no reply yet — nudge while it&apos;s warm</span>
      </div>
      <div className="followup-rows">
        {due.map((lead) => (
          <div className="followup-row" key={lead.id}>
            <span className="followup-author">u/{lead.author}</span>
            <SubChip sub={lead.subreddit} />
            <span className="followup-age tnum">{formatAge(lead.lastEventAt)}</span>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => draft(lead)}
              disabled={drafting === lead.id}
            >
              {drafting === lead.id ? <><Spinner size={11} /> Drafting…</> : 'Draft follow-up'}
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}

// ─── Conversation workspace (Convert #3) ─────────────────────────────────────

const DISCOVERY_TEMPLATE =
  "Really glad this resonates. Would you be up for a quick 15-min call this week so I can understand your setup and see if it's even a fit? No pitch — happy to just trade notes."

const MESSAGE_KIND_LABEL: Record<MessageKind, string> = {
  opener: 'Opener',
  follow_up: 'Follow-up',
  reply: 'Their reply',
  objection_response: 'Objection response',
  note: 'Note',
}

const COMPOSER_KINDS: MessageKind[] = ['note', 'reply', 'follow_up', 'objection_response']

function LeadConversation({ lead, onPatch }: { lead: Lead; onPatch: (lead: Lead) => void }) {
  const [messages, setMessages] = useState<LeadMessage[] | null>(null)
  const [objections, setObjections] = useState<ObjectionEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [composerKind, setComposerKind] = useState<MessageKind>('note')

  const reload = useCallback(async () => {
    try {
      const res = await fetch(`/api/leads/${lead.id}/messages`)
      const json = await res.json()
      if (res.ok) setMessages((json as { messages: LeadMessage[] }).messages)
    } catch {
      setMessages([])
    }
  }, [lead.id])

  useEffect(() => {
    reload()
    fetch(`/api/leads/${lead.id}/objections`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { objections?: ObjectionEntry[] } | null) => {
        if (j?.objections) setObjections(j.objections)
      })
      .catch(() => {})
  }, [lead.id, reload])

  const nextStep = suggestedNextStep({ status: lead.status, sequenceStep: lead.sequenceStep })

  async function addMessage(role: 'outbound' | 'inbound', kind: MessageKind, body: string, sent = false) {
    const res = await fetch(`/api/leads/${lead.id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role, kind, body, sent }),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`)
    return json
  }

  async function draftNextStep() {
    setBusy(true)
    setError(null)
    try {
      if (nextStep === 'discovery_call') {
        await addMessage('outbound', 'follow_up', DISCOVERY_TEMPLATE)
      } else if (nextStep === 'opener') {
        const res = await fetch(`/api/leads/${lead.id}/opener`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'generate' }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`)
        onPatch((json as { lead: Lead }).lead)
        await addMessage('outbound', 'opener', (json as { opener: string }).opener)
      } else {
        // follow_up_1 / follow_up_2 → grounded follow-up draft + schedule
        const res = await fetch(`/api/leads/${lead.id}/follow-up`, { method: 'POST' })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`)
        if ((json as { lead?: Lead }).lead) onPatch((json as { lead: Lead }).lead)
      }
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Draft failed')
    } finally {
      setBusy(false)
    }
  }

  async function draftObjection(objection: string) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/leads/${lead.id}/objections`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ objection }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Draft failed')
    } finally {
      setBusy(false)
    }
  }

  async function markSent(messageId: number) {
    try {
      const res = await fetch(`/api/leads/${lead.id}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'mark-sent', messageId }),
      })
      if (res.ok) await reload()
    } catch {
      /* ignore */
    }
  }

  async function submitComposer() {
    const body = text.trim()
    if (!body || busy) return
    setBusy(true)
    setError(null)
    try {
      const role = composerKind === 'reply' ? 'inbound' : 'outbound'
      await addMessage(role, composerKind, body, role === 'outbound')
      if (role === 'inbound' && (lead.status === 'new' || lead.status === 'contacted')) {
        onPatch({ ...lead, status: 'replied' })
      }
      setText('')
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="convo">
      <div className="convo-thread">
        {messages === null && <div className="convo-empty">Loading thread…</div>}
        {messages?.length === 0 && <div className="convo-empty">No messages yet — draft the next step below.</div>}
        {messages?.map((m) => (
          <div className={`convo-msg convo-${m.role}`} key={m.id}>
            <div className="convo-msg-head">
              <span className="convo-msg-kind">{MESSAGE_KIND_LABEL[m.kind]}</span>
              {m.role === 'outbound' && (m.sent ? <span className="convo-sent">sent ✓</span> : <span className="convo-draft">draft</span>)}
            </div>
            <div className="convo-msg-body">{m.body}</div>
            {m.role === 'outbound' && !m.sent && (
              <button type="button" className="convo-marksent" onClick={() => markSent(m.id)}>Mark sent</button>
            )}
          </div>
        ))}
      </div>

      {error && <div className="convo-err">{error}</div>}

      <div className="convo-actions">
        <button type="button" className="btn btn-primary btn-sm" onClick={draftNextStep} disabled={busy}>
          {busy ? <><Spinner size={11} /> Drafting…</> : <><Icons.sparkles size={12} /> {SEQUENCE_STEP_LABEL[nextStep as SequenceStep]}</>}
        </button>
      </div>

      {objections.length > 0 && (
        <div className="convo-objections">
          <div className="convo-objections-label">Likely objections — draft a response</div>
          <div className="convo-objection-chips">
            {objections.slice(0, 4).map((o) => (
              <button key={o.objection} type="button" className="convo-objection" onClick={() => draftObjection(o.objection)} disabled={busy} title={`${o.type} · seen ${o.count}×`}>
                {o.objection.length > 60 ? `${o.objection.slice(0, 60)}…` : o.objection}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="convo-composer">
        <select className="convo-kind" value={composerKind} onChange={(e) => setComposerKind(e.target.value as MessageKind)} aria-label="Message type">
          {COMPOSER_KINDS.map((k) => (
            <option key={k} value={k}>{MESSAGE_KIND_LABEL[k]}</option>
          ))}
        </select>
        <textarea
          className="convo-input"
          placeholder={composerKind === 'reply' ? 'Paste their reply…' : 'Write a message or note…'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
        />
        <button type="button" className="btn btn-ghost btn-sm" onClick={submitComposer} disabled={busy || !text.trim()}>
          Add
        </button>
      </div>
    </div>
  )
}
