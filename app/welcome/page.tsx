'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useScanCtx, useWatchlistCtx } from '../_components/scan-provider'
import { AdvantageOpportunityCard } from '../_components/components'
import { Icons, Spinner } from '../_components/icons'
import { useSubSuggestions } from '@/lib/use-sub-suggestions'
import type { MaterializedOpportunity } from '@/lib/advantage'

type Step = 'niche' | 'subs' | 'scanning' | 'result'

// 60-second onboarding: niche → suggested subs (same engine as SubSuggester) →
// one scan → land on the #1 Advantage opportunity with evidence + a next action.
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

  const scanStarted = useRef(false)
  const sawStreaming = useRef(false)
  const finalized = useRef(false)

  // Step 1 → 2: create the workspace (best-effort) and ask for sub suggestions.
  async function handleNiche() {
    const n = niche.trim()
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
        /* non-fatal — show the fallback result */
      } finally {
        setFinalizing(false)
        setStep('result')
      }
    })()
  }, [step, scan.anyStreaming, scan.posts.length])

  const scannedCount = scan.posts.length

  return (
    <div className="content scroll">
      <div className="wiz">
        <div className="wiz-steps" aria-hidden="true">
          {(['niche', 'subs', 'scanning', 'result'] as Step[]).map((s, i) => (
            <span key={s} className={`wiz-dot${stepIndex(step) >= i ? ' on' : ''}`} />
          ))}
        </div>

        {step === 'niche' && (
          <section className="wiz-card fade-in">
            <h1 className="wiz-h">What are you building?</h1>
            <p className="wiz-sub">
              Name your niche and we&apos;ll find where your buyers already hang out, scan it,
              and surface your #1 opportunity — in about a minute.
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
                onClick={handleNiche}
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

        {step === 'result' && (
          <section className="wiz-card fade-in">
            <h1 className="wiz-h">
              {topOpp ? 'Your #1 opportunity' : 'Scan complete'}
            </h1>
            {topOpp ? (
              <>
                <p className="wiz-sub">
                  Ranked highest by Advantage — expected value for you. Tap the gauge for the
                  evidence behind the score.
                </p>
                <div className="opp-grid" style={{ marginBottom: 'var(--gap)' }}>
                  <AdvantageOpportunityCard opp={topOpp} selected={false} onSelect={() => router.push('/')} />
                </div>
                <div className="wiz-next">
                  <span className="wiz-next-label">Next:</span>
                  <Link href="/try" className="btn btn-primary btn-sm">Draft your first reply</Link>
                  <Link href="/today" className="btn btn-ghost btn-sm">Go to Today</Link>
                  <Link href="/pipeline" className="btn btn-ghost btn-sm">Find leads to contact</Link>
                </div>
              </>
            ) : (
              <>
                <p className="wiz-sub">
                  Your subs are scanned and on your watchlist. Opportunities populate as more
                  posts come in — open the dashboard to explore what we found.
                </p>
                <Link href="/today" className="btn btn-primary">Open Today</Link>
              </>
            )}
          </section>
        )}
      </div>
    </div>
  )
}

const STEP_ORDER: Step[] = ['niche', 'subs', 'scanning', 'result']
function stepIndex(step: Step): number {
  return STEP_ORDER.indexOf(step)
}
