'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useScanCtx, useWatchlistCtx } from '../_components/scan-provider'
import { AdvantageOpportunityCard } from '../_components/components'
import { HomeHero } from '../_components/home-hero'
import { splitSamples } from '../_components/voice-samples'
import { Icons, Spinner } from '../_components/icons'
import { useSubSuggestions } from '@/lib/use-sub-suggestions'
import type { MaterializedOpportunity } from '@/lib/advantage'

type Step = 'niche' | 'subs' | 'scanning' | 'voice' | 'reply'

// 60-second onboarding: niche → suggested subs (same engine as SubSuggester) →
// one scan → teach it your voice → land on the aha: reply to your hottest buyer
// in your own words. The #1 opportunity rides along as a secondary "what to build".
export default function WelcomeWizard() {
  const router = useRouter()
  const { watchlist, addSubreddit } = useWatchlistCtx()
  const scan = useScanCtx()
  const { suggestions, loading: suggesting, error: suggestError, suggest } = useSubSuggestions()

  const [step, setStep] = useState<Step>('niche')
  const [niche, setNiche] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [topOpp, setTopOpp] = useState<MaterializedOpportunity | null>(null)
  const [finalizing, setFinalizing] = useState(false)
  const [loadingDemo, setLoadingDemo] = useState(false)
  const [voiceText, setVoiceText] = useState('')
  const [savingVoice, setSavingVoice] = useState(false)

  const scanStarted = useRef(false)
  const sawStreaming = useRef(false)
  const finalized = useRef(false)

  // Step 1 → 2: create the workspace (best-effort) and ask for sub suggestions.
  // `explicit` lets the pre-niche carry-over (below) drive this without waiting
  // on the `niche` state update.
  async function handleNiche(explicit?: string) {
    const n = (explicit ?? niche).trim()
    if (n.length < 2 || suggesting) return
    try {
      await fetch('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: n, niche: n }),
      })
    } catch {
      /* projects table may be unmigrated — onboarding continues on default */
    }
    await suggest(n)
    setStep('subs')
  }

  // Carry the niche typed on the public landing/scan (ScanDemo stashes it in
  // localStorage) into onboarding — pre-fill step 1 and auto-advance to subs so
  // the user never re-types it. One-shot.
  const preNicheRan = useRef(false)
  useEffect(() => {
    if (preNicheRan.current) return
    preNicheRan.current = true
    let saved = ''
    try {
      saved = localStorage.getItem('earwise:pre-niche') ?? ''
      if (saved) localStorage.removeItem('earwise:pre-niche')
    } catch {
      /* storage unavailable */
    }
    const n = saved.trim()
    if (n.length >= 2) {
      setNiche(n)
      handleNiche(n)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Skip setup entirely — seed + open the preloaded demo workspace.
  async function handleDemo() {
    if (loadingDemo) return
    setLoadingDemo(true)
    try {
      await fetch('/api/projects/demo', { method: 'POST' })
      window.location.assign('/today')
      return
    } catch {
      setLoadingDemo(false)
    }
  }

  // Default-select all suggestions the first time they arrive.
  useEffect(() => {
    if (suggestions && step === 'subs' && selected.size === 0) {
      setSelected(new Set(suggestions))
    }
  }, [suggestions, step, selected.size])

  function toggle(sub: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(sub)) next.delete(sub)
      else next.add(sub)
      return next
    })
  }

  // Step 2 → 3: add chosen subs to the watchlist, then kick off one scan.
  function handleScan() {
    if (selected.size === 0) return
    for (const sub of selected) addSubreddit(sub)
    scanStarted.current = false
    sawStreaming.current = false
    finalized.current = false
    setStep('scanning')
  }

  // Once the selected subs are in the watchlist, start the scan (the watchlist
  // updates a tick after addSubreddit, so we trigger from an effect).
  useEffect(() => {
    if (step !== 'scanning' || scanStarted.current) return
    const ready = [...selected].every((s) => watchlist.includes(s))
    if (ready && selected.size > 0) {
      scanStarted.current = true
      scan.scanAll()
    }
  }, [step, selected, watchlist, scan])

  // Watch the scan to completion, then materialize + read the #1 opportunity.
  useEffect(() => {
    if (step !== 'scanning' || !scanStarted.current || finalized.current) return
    if (scan.anyStreaming) {
      sawStreaming.current = true
      return
    }
    if (!sawStreaming.current) return // not started streaming yet
    finalized.current = true
    setFinalizing(true)
    ;(async () => {
      try {
        if (scan.posts.length > 0) {
          await fetch('/api/opportunities/refresh', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
          })
        }
        const res = await fetch('/api/opportunities')
        if (res.ok) {
          const json = (await res.json()) as { opportunities?: MaterializedOpportunity[] }
          setTopOpp(json.opportunities?.[0] ?? null)
        }
      } catch {
        /* non-fatal — the reply step still works off hot-signals */
      } finally {
        setFinalizing(false)
        // → teach it your voice first, so the first draft sounds like you.
        setStep('voice')
      }
    })()
  }, [step, scan.anyStreaming, scan.posts.length])

  // Voice step → reply. Save pasted samples (best-effort) so the first opener is
  // voice-grounded, then reveal the hottest buyer. "Skip" advances with none.
  async function handleVoiceContinue() {
    if (savingVoice) return
    const samples = splitSamples(voiceText)
    if (samples.length === 0) {
      setStep('reply')
      return
    }
    setSavingVoice(true)
    try {
      await fetch('/api/voice-samples', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ samples }),
      })
    } catch {
      /* non-fatal — draft falls back to the persona rules */
    } finally {
      setSavingVoice(false)
      setStep('reply')
    }
  }

  const scannedCount = scan.posts.length

  return (
    <div className="content scroll">
      <div className="wiz" style={step === 'reply' ? { maxWidth: 760 } : undefined}>
        <div className="wiz-steps" aria-hidden="true">
          {(['niche', 'subs', 'scanning', 'voice', 'reply'] as Step[]).map((s, i) => (
            <span key={s} className={`wiz-dot${stepIndex(step) >= i ? ' on' : ''}`} />
          ))}
        </div>

        {step === 'niche' && (
          <section className="wiz-card fade-in">
            <h1 className="wiz-h">What are you building?</h1>
            <p className="wiz-sub">
              Name your niche and we&apos;ll find where your buyers already hang out, scan it,
              and draft your first reply — in your own voice — in about a minute.
            </p>
            <input
              className="wiz-input"
              type="text"
              value={niche}
              autoFocus
              placeholder="e.g. AI coding tools, indie SaaS, e-commerce analytics…"
              onChange={(e) => setNiche(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleNiche()
                }
              }}
            />
            <div className="wiz-actions" style={{ justifyContent: 'flex-start' }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => handleNiche()}
                disabled={niche.trim().length < 2 || suggesting}
              >
                {suggesting ? <><Spinner size={14} /> Finding subreddits…</> : <>Continue <Icons.chev size={14} /></>}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={handleDemo} disabled={loadingDemo}>
                {loadingDemo ? <><Spinner size={13} /> Loading demo…</> : 'Browse a demo first →'}
              </button>
            </div>
          </section>
        )}

        {step === 'subs' && (
          <section className="wiz-card fade-in">
            <h1 className="wiz-h">Where your buyers talk</h1>
            <p className="wiz-sub">
              Pick the communities to scan for <strong>{niche}</strong>. We&apos;ve pre-selected
              the strongest matches.
            </p>
            {suggestError && <p className="wiz-err">{suggestError}</p>}
            <div className="wiz-subs">
              {(suggestions ?? []).map((sub) => {
                const on = selected.has(sub)
                return (
                  <button
                    key={sub}
                    type="button"
                    className={`wiz-sub${on ? ' on' : ''}`}
                    onClick={() => toggle(sub)}
                    aria-pressed={on}
                  >
                    {on ? <Icons.x size={12} /> : <Icons.plus size={12} />} r/{sub}
                  </button>
                )
              })}
              {(suggestions ?? []).length === 0 && (
                <p className="wiz-sub">No suggestions came back — go back and try a broader niche.</p>
              )}
            </div>
            <div className="wiz-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStep('niche')}>
                ← Back
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleScan}
                disabled={selected.size === 0}
              >
                <Icons.scan size={15} /> Scan {selected.size} sub{selected.size === 1 ? '' : 's'}
              </button>
            </div>
          </section>
        )}

        {step === 'scanning' && (
          <section className="wiz-card fade-in" style={{ textAlign: 'center' }}>
            <Spinner size={26} color="var(--accent)" />
            <h1 className="wiz-h" style={{ marginTop: 14 }}>
              {finalizing ? 'Ranking your opportunities…' : 'Scanning your market…'}
            </h1>
            <p className="wiz-sub">
              {scannedCount > 0
                ? `${scannedCount} posts analyzed so far`
                : 'Pulling fresh posts and classifying intent'}
            </p>
          </section>
        )}

        {step === 'voice' && (
          <section className="wiz-card fade-in">
            <h1 className="wiz-h">First — how do you write?</h1>
            <p className="wiz-sub">
              Paste 2&ndash;3 of your own real Reddit replies. We use them as a style anchor so
              your first draft sounds like you, not a bot. You can change these later in Settings.
            </p>
            <textarea
              value={voiceText}
              autoFocus
              placeholder={
                'Paste 2–3 of your own replies, separated by a blank line.\n\n' +
                "The tool isn't the problem — intake is. Email's handled by anything; phone and text off a personal number is what nothing solves cleanly."
              }
              onChange={(e) => setVoiceText(e.target.value)}
              rows={8}
              disabled={savingVoice}
              style={{
                width: '100%',
                resize: 'vertical',
                font: 'inherit',
                fontSize: 13,
                lineHeight: 1.55,
                color: 'var(--ink)',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '10px 12px',
                marginBottom: 18,
              }}
            />
            <div className="wiz-actions" style={{ justifyContent: 'flex-start' }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleVoiceContinue}
                disabled={savingVoice}
              >
                {savingVoice ? <><Spinner size={14} /> Saving…</> : <>Continue <Icons.chev size={14} /></>}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setStep('reply')}
                disabled={savingVoice}
              >
                Skip for now →
              </button>
            </div>
          </section>
        )}

        {step === 'reply' && (
          <div className="fade-in">
            <h1 className="wiz-h" style={{ textAlign: 'center' }}>Reply to your first buyer</h1>
            <p className="wiz-sub" style={{ textAlign: 'center' }}>
              Here&apos;s the hottest person asking for what you do, right now. Draft a reply in
              your voice and you&apos;ve made your first move.
            </p>

            <HomeHero />

            {topOpp && (
              <section className="section" style={{ marginTop: 'var(--gap)' }}>
                <div className="section-head">
                  <h2>And here&apos;s what to build</h2>
                  <span className="hint">your #1 opportunity, ranked by Advantage</span>
                </div>
                <div className="opp-grid">
                  <AdvantageOpportunityCard opp={topOpp} selected={false} onSelect={() => router.push('/today?view=opportunities')} />
                </div>
              </section>
            )}

            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 28 }}>
              <Link href="/today" className="btn btn-primary">Go to your home <Icons.chev size={14} /></Link>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const STEP_ORDER: Step[] = ['niche', 'subs', 'scanning', 'voice', 'reply']
function stepIndex(step: Step): number {
  return STEP_ORDER.indexOf(step)
}
