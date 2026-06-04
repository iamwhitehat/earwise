'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { Icons, Spinner } from './icons'
import { INTENT_TYPE_LABEL, type IntentType } from '@/lib/intent-patterns'
import type { HotSignal } from '@/lib/hot-signals'

// The Home hero: the single hottest buyer right now, one at a time. One lime
// action — draft a reply in your voice (reuses the add-to-pipeline + opener
// flow) — then advance the queue. The focal point of the reskinned Home.
type ReplyState = { status: 'idle' | 'working' | 'done' | 'error'; opener?: string; error?: string }

const EXCERPT = 320

export function HomeHero() {
  const [signals, setSignals] = useState<HotSignal[] | null>(null)
  const [idx, setIdx] = useState(0)
  const [reply, setReply] = useState<ReplyState>({ status: 'idle' })

  useEffect(() => {
    let cancelled = false
    fetch('/api/hot-signals?window=24h')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((j: { signals?: HotSignal[] } | null) => {
        if (!cancelled) setSignals(j?.signals ?? [])
      })
    return () => { cancelled = true }
  }, [])

  const current = signals?.[idx]

  async function replyNow(s: HotSignal) {
    setReply({ status: 'working' })
    try {
      const leadRes = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: s.kind, id: s.id, post_id: s.post_id, subreddit: s.subreddit,
          permalink: s.permalink, author: s.author, topic: s.topic,
          intentType: s.intentType, category: s.category, text: s.text,
        }),
      })
      const leadJson = await leadRes.json()
      if (!leadRes.ok) throw new Error(leadJson.error ?? `Error ${leadRes.status}`)
      const leadId = (leadJson as { lead: { id: number; openerDraft: string | null } }).lead.id
      let opener = (leadJson as { lead: { openerDraft: string | null } }).lead.openerDraft ?? ''
      if (!opener) {
        const opRes = await fetch(`/api/leads/${leadId}/opener`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'generate' }),
        })
        const opJson = await opRes.json()
        if (!opRes.ok) throw new Error(opJson.error ?? `Error ${opRes.status}`)
        opener = (opJson as { opener: string }).opener
      }
      setReply({ status: 'done', opener })
    } catch (err) {
      setReply({ status: 'error', error: err instanceof Error ? err.message : 'Draft failed' })
    }
  }

  function next() {
    setReply({ status: 'idle' })
    setIdx((i) => i + 1)
  }

  // Loading skeleton.
  if (signals === null) {
    return (
      <section className="card" style={{ padding: 24, marginBottom: 'var(--gap)' }}>
        <div className="skel" style={{ height: 13, width: '30%', marginBottom: 14 }} />
        <div className="skel" style={{ height: 56 }} />
      </section>
    )
  }

  // Empty (no buyers) or exhausted (cleared the queue) — a momentum reward.
  if (!current) {
    const cleared = signals.length > 0
    return (
      <section className="card fade-in" style={heroBox}>
        <span style={eyebrow}>{cleared ? 'Inbox zero on hot buyers' : 'Your hottest buyer right now'}</span>
        <p style={{ margin: '8px 0 16px', fontSize: 17, color: 'var(--ink)' }}>
          {cleared
            ? "You've worked every hot buyer from the last 24h. Nice."
            : 'No hot buyer in the last 24h. Run a scan to surface fresh demand, or work an opportunity below.'}
        </p>
        <div style={actionsRow}>
          <Link href="/pipeline" className="btn btn-primary btn-sm">View pipeline</Link>
          <Link href="/today?view=opportunities" className="btn btn-ghost btn-sm">Opportunities</Link>
        </div>
      </section>
    )
  }

  const excerpt = current.text.length > EXCERPT ? `${current.text.slice(0, EXCERPT)}…` : current.text
  const intent = INTENT_TYPE_LABEL[current.intentType as IntentType] ?? current.intentType
  const tierColor = current.tier === 'hot' ? 'var(--pain)' : current.tier === 'warm' ? 'var(--score-mid, var(--ink-3))' : 'var(--ink-3)'

  return (
    <section className="card fade-in" style={heroBox}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={eyebrow}>Your hottest buyer right now</span>
        <span className="tnum" style={{ fontSize: 12, color: 'var(--ink-4)' }}>{idx + 1} / {signals.length}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: tierColor }}>
          {current.tier}
        </span>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>u/{current.author}</span>
        <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>r/{current.subreddit}</span>
        <span className="hint">{intent}{current.matchedPhrase ? ` · “${current.matchedPhrase}”` : ''}</span>
      </div>

      <p style={{ margin: '0 0 18px', fontSize: 15, lineHeight: 1.55, color: 'var(--ink-2)', whiteSpace: 'pre-wrap' }}>
        {excerpt}
      </p>

      {reply.status !== 'done' && (
        <div style={actionsRow}>
          <button type="button" className="btn btn-primary" onClick={() => replyNow(current)} disabled={reply.status === 'working'}>
            {reply.status === 'working' ? <><Spinner size={14} /> Drafting your reply…</> : <><Icons.chat size={15} /> Reply in your voice</>}
          </button>
          <a className="btn btn-ghost btn-sm" href={current.permalink} target="_blank" rel="noopener noreferrer">
            Open thread <Icons.ext size={13} />
          </a>
          {signals.length > 1 && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={next} style={{ marginLeft: 'auto' }}>Next buyer →</button>
          )}
        </div>
      )}

      {reply.status === 'error' && (
        <p style={{ marginTop: 12, fontSize: 13, color: 'var(--pain)' }}>{reply.error}</p>
      )}

      {reply.status === 'done' && reply.opener && (
        <div className="fade-in" style={{ marginTop: 14, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <strong style={{ fontSize: 13 }}>Drafted in your voice</strong>
            <CopyButton text={reply.opener} />
          </div>
          <p style={{ whiteSpace: 'pre-wrap', margin: '0 0 14px', lineHeight: 1.6, color: 'var(--ink)' }}>{reply.opener}</p>
          <div style={actionsRow}>
            <a className="btn btn-primary btn-sm" href={current.permalink} target="_blank" rel="noopener noreferrer">
              Open thread to send <Icons.ext size={13} />
            </a>
            {idx + 1 < signals.length
              ? <button type="button" className="btn btn-ghost btn-sm" onClick={next} style={{ marginLeft: 'auto' }}>Next buyer →</button>
              : <Link href="/pipeline" className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }}>View pipeline</Link>}
          </div>
        </div>
      )}
    </section>
  )
}

const heroBox: CSSProperties = {
  padding: '22px 24px',
  marginBottom: 'var(--gap)',
  borderLeft: '3px solid var(--accent)',
}
const eyebrow: CSSProperties = {
  fontSize: 11.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-3)',
}
const actionsRow: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      style={{ flexShrink: 0, padding: '3px 9px' }}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch { /* clipboard unavailable */ }
      }}
    >
      {copied ? <span style={{ color: 'var(--score-high)' }}>Copied</span> : 'Copy'}
    </button>
  )
}
