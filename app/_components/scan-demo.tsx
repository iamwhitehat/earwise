'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { track } from '@vercel/analytics'
import { Icons, Spinner } from './icons'

// The interactive free-scan widget — the top-of-funnel aha. Type a niche → POST
// /api/public/scan → 3 real buyers + 1 in-voice reply → "create account to
// unlock". Self-contained + styled with the marketing-site tokens (var(--surface),
// var(--signal), …), so it renders native inside `.ew-site` (the landing hero
// and the standalone /scan page). The typed niche is stashed in localStorage so
// onboarding can pre-fill it after signup. /api/public/scan is IP-rate-limited.

const PRE_NICHE_KEY = 'earwise:pre-niche'

// One-click examples — kill "what do I type?" friction and steer visitors to
// commercial niches that demo well (vs. a random word that returns weak matches).
const EXAMPLE_NICHES = ['indie SaaS', 'Shopify apps', 'freelance web design', 'AI coding tools']

// Stepped loader copy — turns the ~5s wait into visible work being done for them.
const SCAN_STEPS = [
  'Finding where your buyers gather…',
  'Reading fresh threads…',
  'Ranking by intent…',
  'Drafting your reply…',
]

type Buyer = {
  author: string
  subreddit: string
  permalink: string
  why: string
  tier: string
  excerpt: string
}
type ScanResult = {
  buyers: Buyer[]
  lockedCount: number
  reply: string | null
  subs: string[]
  reason?: string
}
type Phase =
  | { status: 'idle' }
  | { status: 'scanning' }
  | { status: 'done'; result: ScanResult }
  | { status: 'error'; message: string }

/** Remember the typed niche so /welcome can pre-fill step 1 after signup. */
function rememberNiche(niche: string) {
  try {
    localStorage.setItem(PRE_NICHE_KEY, niche)
  } catch {
    /* localStorage unavailable — funnel still works, just re-asks the niche */
  }
}

/** Stash the niche + record where in the demo the signup click came from. */
function signupClick(from: string, niche: string) {
  rememberNiche(niche)
  track('signup_click', { from })
}

export function ScanDemo({ autoFocus = false }: { autoFocus?: boolean }) {
  const [niche, setNiche] = useState('')
  const [phase, setPhase] = useState<Phase>({ status: 'idle' })
  const [focused, setFocused] = useState(false)
  const [step, setStep] = useState(0)
  const lockRef = useRef<HTMLDivElement>(null)

  // Advance the stepped loader while scanning; reset otherwise.
  useEffect(() => {
    if (phase.status !== 'scanning') {
      setStep(0)
      return
    }
    const id = setInterval(() => setStep((s) => Math.min(s + 1, SCAN_STEPS.length - 1)), 1300)
    return () => clearInterval(id)
  }, [phase.status])

  // Nudge: once results render, bring the "Create account" lock into view — the
  // aha already happened above it. Honors reduced-motion.
  useEffect(() => {
    if (phase.status !== 'done' || phase.result.buyers.length === 0) return
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const t = setTimeout(() => {
      lockRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' })
    }, 400)
    return () => clearTimeout(t)
  }, [phase])

  async function run(explicit?: string) {
    const n = (explicit ?? niche).trim()
    if (n.length < 2 || phase.status === 'scanning') return
    rememberNiche(n)
    track('scan_started', { source: explicit ? 'chip' : 'input' })
    setPhase({ status: 'scanning' })
    try {
      const res = await fetch('/api/public/scan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ niche: n }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error((json as { error?: string }).error ?? `Error ${res.status}`)
      const result = json as ScanResult
      setPhase({ status: 'done', result })
      track('scan_completed', { buyers: result.buyers.length, locked: result.lockedCount })
    } catch (err) {
      setPhase({ status: 'error', message: err instanceof Error ? err.message : 'Scan failed' })
    }
  }

  const scanning = phase.status === 'scanning'

  return (
    <div className="scan-demo" style={{ width: '100%', textAlign: 'left' }}>
      <div style={inputRow}>
        <input
          type="text"
          value={niche}
          autoFocus={autoFocus}
          placeholder="Your niche — e.g. Shopify apps, indie SaaS, freelance web design"
          onChange={(e) => setNiche(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              run()
            }
          }}
          disabled={scanning}
          style={{ ...inputStyle, borderColor: focused ? 'var(--signal)' : 'var(--line)' }}
        />
        <button
          type="button"
          className="btn btn-lime"
          onClick={() => run()}
          disabled={niche.trim().length < 2 || scanning}
          style={{ flexShrink: 0, whiteSpace: 'nowrap' }}
        >
          {scanning ? <><Spinner size={14} /> Scanning…</> : <><Icons.scan size={15} /> Scan free</>}
        </button>
      </div>
      {scanning ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 12, fontSize: 13.5, color: 'var(--text)' }}>
          <Spinner size={14} />
          <span className="step-loader" key={step}>{SCAN_STEPS[step]}</span>
        </div>
      ) : (
        <div style={{ fontSize: 12.5, color: 'var(--muted-2)', marginTop: 8 }}>
          Free demo · no signup · scans Reddit live. Signup adds Hacker News &amp; StackOverflow.
        </div>
      )}

      {phase.status === 'idle' && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12, alignItems: 'center' }}>
          <span style={{ fontSize: 12.5, color: 'var(--muted-2)' }}>Try:</span>
          {EXAMPLE_NICHES.map((ex) => (
            <button key={ex} type="button" onClick={() => { setNiche(ex); run(ex) }} style={chipStyle}>
              {ex}
            </button>
          ))}
        </div>
      )}

      {phase.status === 'error' && (
        <div style={{ ...cardStyle, marginTop: 16, borderColor: 'var(--signal-neg)' }}>
          <div style={{ color: 'var(--text)', fontSize: 14 }}>{phase.message}</div>
          <div style={{ marginTop: 10 }}>
            <Link href="/login" className="btn btn-lime btn-sm" onClick={() => signupClick('error', niche.trim())}>
              Create a free account to keep scanning
            </Link>
          </div>
        </div>
      )}

      {phase.status === 'done' && <Results result={phase.result} niche={niche.trim()} lockRef={lockRef} />}
    </div>
  )
}

function Results({
  result,
  niche,
  lockRef,
}: {
  result: ScanResult
  niche: string
  lockRef: React.RefObject<HTMLDivElement | null>
}) {
  const subsLabel = result.subs.length ? result.subs.map((s) => `r/${s}`).join(', ') : 'those communities'

  if (result.buyers.length === 0) {
    return (
      <div style={{ ...cardStyle, marginTop: 16 }}>
        <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14, lineHeight: 1.55 }}>
          No one&apos;s <strong style={{ color: 'var(--text)' }}>actively asking to buy</strong> in {subsLabel} this
          minute — try a broader niche, or{' '}
          <Link
            href="/login"
            onClick={() => signupClick('no-buyers', niche)}
            style={{ color: 'var(--signal-deep)', fontWeight: 600 }}
          >
            create a free account
          </Link>{' '}
          to watch them around the clock.
        </p>
      </div>
    )
  }

  return (
    <div style={{ marginTop: 18 }} className="result-in">
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted-2)', marginBottom: 10 }}>
        Buyers asking right now in {subsLabel}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {result.buyers.map((b, i) => (
          <div key={i} style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>u/{b.author}</span>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>r/{b.subreddit}</span>
              <span style={badge}>{b.why}</span>
            </div>
            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: 'var(--muted)', whiteSpace: 'pre-wrap' }}>
              {b.excerpt}
            </p>
            <div style={{ marginTop: 10 }}>
              <a className="btn btn-ghost btn-sm" href={b.permalink} target="_blank" rel="noopener noreferrer">
                Open thread <Icons.ext size={13} />
              </a>
            </div>

            {i === 0 && result.reply && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <strong style={{ fontSize: 12.5, color: 'var(--signal-deep)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                    Reply drafted in your voice
                  </strong>
                  <CopyButton text={result.reply} />
                </div>
                <p style={{ whiteSpace: 'pre-wrap', margin: 0, lineHeight: 1.6, color: 'var(--text)', fontSize: 14 }}>
                  {result.reply}
                </p>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* The lock — the conversion moment. */}
      <div ref={lockRef} style={lockBox}>
        <div style={{ fontSize: 15, color: 'var(--text)', marginBottom: 14, lineHeight: 1.5 }}>
          {result.lockedCount > 0 ? (
            <>
              <strong>{result.lockedCount} more {result.lockedCount === 1 ? 'buyer' : 'buyers'}</strong> are locked —
              plus a fresh batch every day, each with a reply in your voice.
            </>
          ) : (
            <>Get a fresh batch of buyers every day, each with a reply drafted in your voice.</>
          )}
        </div>
        <Link href="/login" className="btn btn-lime" onClick={() => signupClick('lock', niche)}>
          Create your free account <Icons.chev size={14} />
        </Link>
      </div>
    </div>
  )
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
      {copied ? <span style={{ color: 'var(--signal-deep)' }}>Copied</span> : 'Copy'}
    </button>
  )
}

const inputRow: CSSProperties = {
  display: 'flex',
  gap: 10,
  alignItems: 'stretch',
  flexWrap: 'wrap',
}
const inputStyle: CSSProperties = {
  flex: 1,
  minWidth: 220,
  font: 'inherit',
  fontSize: 15,
  color: 'var(--text)',
  background: 'var(--surface)',
  border: '1px solid var(--line)',
  borderRadius: 10,
  padding: '13px 15px',
  outline: 'none',
  transition: 'border-color .15s',
}
const cardStyle: CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--line)',
  borderRadius: 14,
  padding: 18,
}
const chipStyle: CSSProperties = {
  font: 'inherit',
  fontSize: 12.5,
  fontWeight: 500,
  color: 'var(--text)',
  background: 'var(--surface-2)',
  border: '1px solid var(--line)',
  borderRadius: 99,
  padding: '5px 12px',
  cursor: 'pointer',
}
const badge: CSSProperties = {
  fontSize: 11.5,
  fontWeight: 600,
  padding: '2px 9px',
  borderRadius: 99,
  background: 'var(--surface-2)',
  color: 'var(--muted)',
}
const lockBox: CSSProperties = {
  marginTop: 14,
  padding: '22px 22px',
  borderRadius: 14,
  background: 'var(--surface)',
  border: '1px solid var(--line)',
  borderLeft: '3px solid var(--signal)',
  textAlign: 'center',
}
