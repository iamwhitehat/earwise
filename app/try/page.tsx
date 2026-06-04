'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Icons, Spinner } from '../_components/icons'
import { INTENT_TYPE_LABEL } from '@/lib/intent-patterns'
import type { RankedBuyer } from '@/lib/try-find'

// The wedge: subreddit → earwise finds the highest buyer-intent post → drafts one
// reply in the founder's voice. First-run collects voice samples inline; a thin or
// empty scan falls back to paste-a-post so the payoff always lands.

type Phase = 'loading' | 'voice' | 'input' | 'finding' | 'result' | 'fallback'

const EXCERPT_MAX = 420

function splitSamples(text: string): string[] {
  return text.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean).slice(0, 5)
}

export default function TryPage() {
  const [phase, setPhase] = useState<Phase>('loading')

  // Voice setup
  const [voiceText, setVoiceText] = useState('')
  const [savingVoice, setSavingVoice] = useState(false)

  // Find
  const [subreddit, setSubreddit] = useState('')
  const [finding, setFinding] = useState(false)
  const [buyers, setBuyers] = useState<RankedBuyer[]>([])
  const [selected, setSelected] = useState(0)
  const [findNote, setFindNote] = useState<string | null>(null)

  // Fallback paste
  const [postText, setPostText] = useState('')

  // Reply
  const [reply, setReply] = useState<string | null>(null)
  const [drafting, setDrafting] = useState(false)
  const [replyError, setReplyError] = useState<string | null>(null)

  // First run? Decide whether to collect voice samples before anything else.
  useEffect(() => {
    let cancelled = false
    fetch('/api/voice-samples')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((res) => {
        if (cancelled) return
        const has = ((res?.samples as string[] | undefined) ?? []).length > 0
        setPhase(has ? 'input' : 'voice')
      })
    return () => { cancelled = true }
  }, [])

  async function saveVoice() {
    if (savingVoice) return
    setSavingVoice(true)
    try {
      await fetch('/api/voice-samples', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ samples: splitSamples(voiceText) }),
      })
    } catch {
      /* non-fatal — generation falls back to the persona rules */
    } finally {
      setSavingVoice(false)
      setPhase('input')
    }
  }

  async function findBuyer() {
    const sub = subreddit.trim().replace(/^\/?r\//i, '')
    if (!sub || finding) return
    setFinding(true)
    setFindNote(null)
    setReply(null)
    setPhase('finding')
    try {
      const res = await fetch('/api/try/find', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subreddit: sub }),
      })
      const json = await res.json().catch(() => ({}))
      const found = (json.buyers as RankedBuyer[] | undefined) ?? []
      if (found.length > 0) {
        setBuyers(found)
        setSelected(0)
        setPhase('result')
      } else {
        setFindNote(`No clear buyer in r/${sub} right now — paste a post you already have in mind.`)
        setPhase('fallback')
      }
    } catch {
      setFindNote('Find failed. You can paste a post instead.')
      setPhase('fallback')
    } finally {
      setFinding(false)
    }
  }

  async function draftReply(input: { subreddit: string; author: string; text: string; intentType?: string | null }) {
    if (drafting) return
    setDrafting(true)
    setReplyError(null)
    setReply(null)
    try {
      const res = await fetch('/api/signals/draft-reply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          subreddit: input.subreddit || 'reddit',
          author: input.author,
          text: input.text,
          intentType: input.intentType ?? undefined,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.reply) throw new Error(json.error ?? 'No reply came back.')
      setReply(json.reply as string)
    } catch (err) {
      setReplyError(err instanceof Error ? err.message : 'Draft failed.')
    } finally {
      setDrafting(false)
    }
  }

  function restart() {
    setBuyers([]); setReply(null); setReplyError(null); setFindNote(null); setPhase('input')
  }

  return (
    <div className="content scroll">
      <div className="wiz">
        {phase === 'loading' && (
          <section className="wiz-card fade-in" style={{ textAlign: 'center' }}>
            <Spinner size={22} color="var(--accent)" />
          </section>
        )}

        {phase === 'voice' && (
          <section className="wiz-card fade-in">
            <h1 className="wiz-h">First, how do you write?</h1>
            <p className="wiz-sub">
              Paste 2–3 of your own real Reddit replies, separated by a blank line. earwise
              matches your rhythm so the reply sounds like you — not a bot.
            </p>
            <textarea
              className="wiz-input"
              style={{ minHeight: 150, resize: 'vertical', fontFamily: 'inherit' }}
              autoFocus
              placeholder={"The tool isn't the problem — intake is. Email's handled by anything; phone and text off a personal number is what nothing solves cleanly."}
              value={voiceText}
              onChange={(e) => setVoiceText(e.target.value)}
            />
            <div className="wiz-actions" style={{ justifyContent: 'flex-start' }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={saveVoice}
                disabled={splitSamples(voiceText).length === 0 || savingVoice}
              >
                {savingVoice ? <><Spinner size={14} /> Saving…</> : <>Continue <Icons.chev size={14} /></>}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPhase('input')}>
                Skip for now
              </button>
            </div>
          </section>
        )}

        {phase === 'input' && (
          <section className="wiz-card fade-in">
            <h1 className="wiz-h">Find a buyer to reply to</h1>
            <p className="wiz-sub">
              Name a subreddit where your buyers hang out. earwise pulls recent posts, finds the
              one most likely to be an active buyer, and drafts a reply in your voice.
            </p>
            <input
              className="wiz-input"
              type="text"
              autoFocus
              placeholder="e.g. SaaS, msp, smallbusiness…"
              value={subreddit}
              onChange={(e) => setSubreddit(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); findBuyer() } }}
            />
            <div className="wiz-actions" style={{ justifyContent: 'flex-start' }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={findBuyer}
                disabled={subreddit.trim().length < 2}
              >
                <Icons.scan size={15} /> Find a buyer
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPhase('fallback')}>
                or paste a post →
              </button>
            </div>
          </section>
        )}

        {phase === 'finding' && (
          <section className="wiz-card fade-in" style={{ textAlign: 'center' }}>
            <Spinner size={26} color="var(--accent)" />
            <h1 className="wiz-h" style={{ marginTop: 14 }}>Reading r/{subreddit.trim().replace(/^\/?r\//i, '')}…</h1>
            <p className="wiz-sub">Pulling recent posts and finding the strongest buyer signal.</p>
          </section>
        )}

        {phase === 'result' && buyers[selected] && (
          <section className="wiz-card fade-in">
            <h1 className="wiz-h">Here&apos;s a buyer</h1>
            {buyers.length > 1 && (
              <div className="wiz-subs" style={{ marginBottom: 16 }}>
                {buyers.map((b, i) => (
                  <button
                    key={b.externalId}
                    type="button"
                    className={`wiz-sub${i === selected ? ' on' : ''}`}
                    onClick={() => { setSelected(i); setReply(null); setReplyError(null) }}
                    aria-pressed={i === selected}
                  >
                    #{i + 1} · {b.score}
                  </button>
                ))}
              </div>
            )}
            <BuyerView buyer={buyers[selected]} />
            <div className="wiz-actions" style={{ justifyContent: 'flex-start', marginTop: 16 }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  const b = buyers[selected]
                  draftReply({ subreddit: b.subreddit, author: b.author, text: b.excerpt, intentType: b.intentType })
                }}
                disabled={drafting}
              >
                {drafting ? <><Spinner size={14} /> Writing…</> : <><Icons.chat size={14} /> {reply ? 'Regenerate' : 'Draft reply in my voice'}</>}
              </button>
              <a className="btn btn-ghost btn-sm" href={buyers[selected].permalink} target="_blank" rel="noopener noreferrer">
                Open thread <Icons.ext size={13} />
              </a>
              <button type="button" className="btn btn-ghost btn-sm" onClick={restart}>Try another sub</button>
            </div>
            <ReplyView reply={reply} error={replyError} />
          </section>
        )}

        {phase === 'fallback' && (
          <section className="wiz-card fade-in">
            <h1 className="wiz-h">Paste a post</h1>
            <p className="wiz-sub">
              {findNote ?? 'Paste the text of a Reddit post or comment and earwise drafts a reply in your voice.'}
            </p>
            <textarea
              className="wiz-input"
              style={{ minHeight: 130, resize: 'vertical', fontFamily: 'inherit' }}
              autoFocus
              placeholder="Paste the post or comment text here…"
              value={postText}
              onChange={(e) => setPostText(e.target.value)}
            />
            <div className="wiz-actions" style={{ justifyContent: 'flex-start' }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => draftReply({ subreddit: subreddit.trim().replace(/^\/?r\//i, ''), author: '', text: postText.trim() })}
                disabled={postText.trim().length < 10 || drafting}
              >
                {drafting ? <><Spinner size={14} /> Writing…</> : <><Icons.chat size={14} /> {reply ? 'Regenerate' : 'Draft reply in my voice'}</>}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPhase('input')}>← Find a buyer instead</button>
            </div>
            <ReplyView reply={reply} error={replyError} />
          </section>
        )}
      </div>
    </div>
  )
}

function BuyerView({ buyer }: { buyer: RankedBuyer }) {
  const excerpt = buyer.excerpt.length > EXCERPT_MAX ? `${buyer.excerpt.slice(0, EXCERPT_MAX)}…` : buyer.excerpt
  return (
    <div className="card" style={{ padding: 'var(--pad)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <span className="badge" style={{ background: 'var(--surface-2)', color: 'var(--ink-2)' }}>
          {buyer.intentType ? INTENT_TYPE_LABEL[buyer.intentType] : 'active buyer'}
        </span>
        <span className="hint">u/{buyer.author || 'unknown'} · r/{buyer.subreddit} · why: {buyer.why}</span>
      </div>
      <p className="t-mdp" style={{ whiteSpace: 'pre-wrap', color: 'var(--ink-2)', margin: 0, lineHeight: 1.55 }}>{excerpt}</p>
    </div>
  )
}

function ReplyView({ reply, error }: { reply: string | null; error: string | null }) {
  if (error) {
    return (
      <div className="card" style={{ padding: '12px 15px', marginTop: 14, background: 'var(--pain-bg)', color: 'var(--ink-2)', fontSize: 13 }}>
        <strong style={{ color: 'var(--pain)' }}>Couldn&apos;t draft:</strong> {error}
      </div>
    )
  }
  if (!reply) return null
  return (
    <div className="card" style={{ padding: 'var(--pad)', marginTop: 16, borderColor: 'var(--accent-ring, var(--border))' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
        <strong style={{ fontSize: 13 }}>Your reply</strong>
        <CopyButton text={reply} />
      </div>
      <p style={{ whiteSpace: 'pre-wrap', margin: 0, lineHeight: 1.6, color: 'var(--ink)' }}>{reply}</p>
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      style={{ padding: '3px 9px' }}
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
