'use client'

import { useState, type ReactNode } from 'react'
import type { Category } from '@/lib/categories'
import type { IntentType } from '@/lib/intent-patterns'
import { INTENT_TYPE_LABEL } from '@/lib/intent-patterns'
import { CategoryBadge, SubChip } from './components'
import { Icons, Spinner } from './icons'

export type Signal = {
  kind: 'post' | 'comment'
  id: string
  post_id: string
  subreddit: string
  author: string
  text: string
  matchedPhrase: string
  intentType: IntentType
  category: Category
  topic: string | null
  analyzedAt: number
  permalink: string
}

const STALE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const SNIPPET_RADIUS = 220
const SNIPPET_CHARS = 480

export function formatAge(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

/**
 * Build a short snippet centered on the matched phrase, with the phrase
 * wrapped in <mark>. Falls back to the text head when no phrase is given or
 * no match position is found. Exported so the Leads board reuses the exact
 * highlight behavior.
 */
export function snippetWithHighlight(text: string, phrase: string): ReactNode {
  if (!text) return null
  // Empty phrase would make indexOf('') loop forever below — show the head.
  if (!phrase) {
    const head = text.slice(0, SNIPPET_CHARS)
    return <>{head}{text.length > SNIPPET_CHARS ? '…' : ''}</>
  }
  const lower = text.toLowerCase()
  const idx = lower.indexOf(phrase.toLowerCase())
  let start = 0
  let end = Math.min(text.length, SNIPPET_CHARS)
  if (idx >= 0) {
    start = Math.max(0, idx - SNIPPET_RADIUS)
    end = Math.min(text.length, idx + phrase.length + SNIPPET_RADIUS)
    if (end - start > SNIPPET_CHARS) end = start + SNIPPET_CHARS
  }
  const prefix = start > 0 ? '…' : ''
  const suffix = end < text.length ? '…' : ''
  const slice = text.slice(start, end)
  if (idx < 0) return <>{prefix}{slice}{suffix}</>

  // Highlight every case-insensitive occurrence of the phrase inside the slice.
  const sliceLower = slice.toLowerCase()
  const parts: ReactNode[] = []
  let cursor = 0
  while (cursor < slice.length) {
    const next = sliceLower.indexOf(phrase.toLowerCase(), cursor)
    if (next < 0) {
      parts.push(slice.slice(cursor))
      break
    }
    if (next > cursor) parts.push(slice.slice(cursor, next))
    parts.push(<mark key={`m-${next}`}>{slice.slice(next, next + phrase.length)}</mark>)
    cursor = next + phrase.length
  }
  return (
    <>
      {prefix}
      {parts.map((p, i) => (typeof p === 'string' ? <span key={i}>{p}</span> : p))}
      {suffix}
    </>
  )
}

type DraftState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; reply: string }
  | { status: 'error'; error: string }

export function SignalCard({ signal }: { signal: Signal }) {
  const stale = Date.now() - signal.analyzedAt > STALE_MS
  const [draft, setDraft] = useState<DraftState>({ status: 'idle' })
  const [copied, setCopied] = useState(false)

  async function handleDraft() {
    setDraft({ status: 'loading' })
    try {
      const res = await fetch('/api/signals/draft-reply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          subreddit: signal.subreddit,
          author: signal.author,
          text: signal.text,
          topic: signal.topic,
          intentType: signal.intentType,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`)
      setDraft({ status: 'ready', reply: (json as { reply: string }).reply })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setDraft({ status: 'error', error: msg })
    }
  }

  async function handleCopy() {
    if (draft.status !== 'ready') return
    try {
      await navigator.clipboard.writeText(draft.reply)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard API can fail (insecure context, permissions). Silent — user
      // can still select + copy the text manually.
    }
  }

  return (
    <article className={`signal-card${stale ? ' is-stale' : ''}`}>
      <header className="signal-head">
        <span className={`signal-kind signal-kind-${signal.kind}`}>
          {signal.kind === 'post' ? 'Post' : 'Comment'}
        </span>
        <span className={`signal-intent intent-${signal.intentType}`}>
          {INTENT_TYPE_LABEL[signal.intentType]}
        </span>
        <SubChip sub={signal.subreddit} />
        <span className="signal-author">u/{signal.author}</span>
        <CategoryBadge cat={signal.category} />
        {signal.topic && (
          <span
            className="badge"
            style={{ color: 'var(--accent-text)', background: 'var(--accent-soft)' }}
          >
            {signal.topic}
          </span>
        )}
        <span className="signal-time" style={{ marginLeft: 'auto' }}>
          <Icons.clock size={11} /> {formatAge(signal.analyzedAt)}
        </span>
      </header>

      <p className="signal-text">{snippetWithHighlight(signal.text, signal.matchedPhrase)}</p>

      <div className="signal-actions">
        <a
          className="btn btn-ghost btn-sm"
          href={signal.permalink}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Icons.ext size={13} /> Reply on Reddit
        </a>
        {draft.status === 'idle' && (
          <button type="button" className="btn btn-primary btn-sm" onClick={handleDraft}>
            <Icons.sparkles size={13} /> Draft reply
          </button>
        )}
        {draft.status === 'loading' && (
          <button type="button" className="btn btn-primary btn-sm" disabled>
            <Spinner size={11} /> Drafting…
          </button>
        )}
        {draft.status === 'ready' && (
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={handleDraft}>
              <Icons.sparkles size={13} /> Regenerate
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={handleCopy}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </>
        )}
        {draft.status === 'error' && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={handleDraft}>
            Retry
          </button>
        )}
      </div>

      {draft.status === 'ready' && (
        <div className="signal-draft">
          <div className="signal-draft-label">Suggested reply · adapt before sending</div>
          <div className="signal-draft-body">{draft.reply}</div>
        </div>
      )}
      {draft.status === 'error' && (
        <div className="signal-draft signal-draft-error">{draft.error}</div>
      )}
    </article>
  )
}
