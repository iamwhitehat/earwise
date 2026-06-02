'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Topbar, SubChip, CategoryBadge, LeadScoreBadge, HotNowLane } from '../_components/components'
import { snippetWithHighlight, formatAge } from '../_components/signal-card'
import { Icons, Spinner } from '../_components/icons'
import { useScanCtx } from '../_components/scan-provider'
import { findFirstMatch } from '@/lib/intent-patterns'
import {
  LEAD_STATUSES,
  LEAD_STATUS_LABEL,
  emptyStatusCounts,
  type Lead,
  type LeadStatus,
} from '@/lib/leads'
import type { Category } from '@/lib/categories'

const TOP_SIGNALS_TO_ADD = 15

export default function LeadsPage() {
  const scan = useScanCtx()
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
      <Topbar title="Leads" posts={scan.posts}>
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
      </Topbar>

      <div className="content scroll">
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

        {!loading && hasLeads && (
          <div className="leads-board scroll">
            {LEAD_STATUSES.map((status) => (
              <section className="leads-col" key={status}>
                <div className="leads-col-head">
                  <span className={`leads-col-title status-${status}`}>
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
      </div>
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
    </article>
  )
}
