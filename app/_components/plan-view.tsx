'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Icons, Spinner } from './icons'
import { SynthModelSelect } from './components'
import { useSynthModel } from '@/lib/use-synth-model'
import {
  EMPTY_PROFILE,
  type BusinessProfile,
  type StrategyBrief,
} from '@/lib/strategy'

type StrategyRun = {
  id: number
  brief: StrategyBrief
  model: string
  promptVersion: string
  inputsHash: string
  generatedAt: number
}

type Step = { key: string; label: string; status: 'running' | 'done' }

const FIELDS: Array<{ key: keyof BusinessProfile; label: string; placeholder: string; long?: boolean }> = [
  { key: 'product', label: 'Product', placeholder: 'What are you building?' },
  { key: 'valueProp', label: 'Value proposition', placeholder: 'The one-line promise', long: true },
  { key: 'icp', label: 'Ideal customer', placeholder: 'Who is it for?' },
  { key: 'stage', label: 'Stage', placeholder: 'idea / building / launched / scaling' },
  { key: 'primaryGoal', label: 'Primary goal', placeholder: 'e.g. first 10 customers' },
  { key: 'skills', label: 'Your skills / assets', placeholder: 'e.g. strong at content, ex-Stripe' },
  { key: 'channels', label: 'Distribution channels', placeholder: 'e.g. Twitter, cold email, a 5k newsletter' },
  { key: 'constraints', label: 'Constraints', placeholder: 'e.g. solo, no ad budget, nights+weekends' },
  { key: 'url', label: 'URL', placeholder: 'https://…' },
]

export function PlanView() {
  const { tier, setTier } = useSynthModel()
  const [profile, setProfile] = useState<BusinessProfile>(EMPTY_PROFILE)
  const [run, setRun] = useState<StrategyRun | null>(null)
  const [steps, setSteps] = useState<Step[]>([])
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch('/api/strategy/profile').then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch('/api/strategy').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([profileRes, runRes]) => {
      if (cancelled) return
      if (profileRes?.profile) setProfile(profileRes.profile as BusinessProfile)
      if (runRes) setRun(runRes as StrategyRun)
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  function setField(key: keyof BusinessProfile, value: string) {
    setProfile((p) => ({ ...p, [key]: value }))
  }

  async function handleRun() {
    if (running) return
    setRunning(true)
    setError(null)
    setSteps([])
    try {
      const res = await fetch('/api/strategy/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tier, profile }),
      })
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}))
        throw new Error((j as { error?: string }).error ?? `Error ${res.status}`)
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        let nl: number
        while ((nl = buf.indexOf('\n')) !== -1) {
          const line = buf.slice(0, nl).trim()
          buf = buf.slice(nl + 1)
          if (!line) continue
          handleEvent(JSON.parse(line))
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Run failed')
    } finally {
      setRunning(false)
    }
  }

  function handleEvent(ev: Record<string, unknown>) {
    if (ev.type === 'step') {
      const key = ev.key as string
      const label = ev.label as string
      const status = ev.status as Step['status']
      setSteps((prev) => {
        const next = prev.filter((s) => s.key !== key)
        next.push({ key, label, status })
        return next
      })
    } else if (ev.type === 'done') {
      setRun(ev.run as StrategyRun)
    } else if (ev.type === 'error') {
      setError((ev.message as string) ?? 'Run failed')
    }
  }

  return (
    <>
      <div className="pipe-actions" style={{ gap: 10 }}>
        <SynthModelSelect value={tier} onChange={setTier} disabled={running} />
        <button type="button" className="btn btn-primary btn-sm" onClick={handleRun} disabled={running}>
          {running ? (
            <>
              <Spinner size={13} /> Running…
            </>
          ) : (
            <>
              <Icons.sparkles size={14} /> {run ? 'Re-run strategist' : 'Run strategist'}
            </>
          )}
        </button>
      </div>

      <>
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

        <section className="section" style={{ marginBottom: 0 }}>
          <div className="section-head">
            <h2>Your business</h2>
            <span className="hint">grounds the plan — saved on run</span>
          </div>
          <div className="card" style={{ padding: 'var(--pad)' }}>
            <div className="guide-form">
              {FIELDS.map((f) => (
                <label key={f.key} className={`guide-field${f.long ? ' guide-field-wide' : ''}`}>
                  <span>{f.label}</span>
                  <input
                    type="text"
                    value={profile[f.key]}
                    placeholder={f.placeholder}
                    onChange={(e) => setField(f.key, e.target.value)}
                    disabled={!loaded || running}
                  />
                </label>
              ))}
            </div>
          </div>
        </section>

        {(running || steps.length > 0) && !run && (
          <section className="section" style={{ marginTop: 'var(--gap)', marginBottom: 0 }}>
            <div className="card" style={{ padding: 'var(--pad)' }}>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {steps.map((s) => (
                  <li key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13 }}>
                    {s.status === 'done' ? (
                      <span style={{ color: 'var(--score-high)' }}>✓</span>
                    ) : (
                      <Spinner size={12} color="var(--ink-3)" />
                    )}
                    <span style={{ color: s.status === 'done' ? 'var(--ink-2)' : 'var(--ink)' }}>{s.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {run && <BriefView run={run} />}
      </>
    </>
  )
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      style={{ flexShrink: 0, padding: '3px 8px' }}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          /* clipboard unavailable */
        }
      }}
    >
      {copied ? <span style={{ color: 'var(--score-high)' }}>Copied</span> : 'Copy'}
    </button>
  )
}

function Block({ title, copyText, defaultOpen = true, children }: { title: string; copyText?: string; defaultOpen?: boolean; children: React.ReactNode }) {
  return (
    <details className="guide-block" open={defaultOpen}>
      <summary>
        <span>{title}</span>
        {copyText && (
          <span onClick={(e) => e.preventDefault()} style={{ marginLeft: 'auto' }}>
            <CopyBtn text={copyText} />
          </span>
        )}
      </summary>
      <div className="guide-block-body">{children}</div>
    </details>
  )
}

function BriefView({ run }: { run: StrategyRun }) {
  const b = run.brief
  const ts = new Date(run.generatedAt).toLocaleString()
  return (
    <section className="section" style={{ marginTop: 30 }}>
      <div className="section-head">
        <h2>Your plan</h2>
        <span className="hint">
          {run.model} · {ts}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {b.positioning && (
          <Block title="Positioning" copyText={b.positioning}>
            <p className="guide-p">{b.positioning}</p>
          </Block>
        )}

        {b.icp && (
          <Block title="Ideal customer to start with" copyText={b.icp}>
            <p className="guide-p">{b.icp}</p>
          </Block>
        )}

        {b.messaging.length > 0 && (
          <Block title="Key messages" copyText={b.messaging.join('\n')}>
            <ul className="guide-ul">
              {b.messaging.map((m, i) => <li key={i}>{m}</li>)}
            </ul>
          </Block>
        )}

        {b.distribution.length > 0 && (
          <Block title="Distribution channels">
            <ul className="guide-ul">
              {b.distribution.map((d, i) => (
                <li key={i}>
                  <strong>{d.channel}</strong> — {d.why}
                </li>
              ))}
            </ul>
          </Block>
        )}

        <Block title="30 / 60 / 90 day roadmap">
          <div className="guide-roadmap">
            {(['thirty', 'sixty', 'ninety'] as const).map((k, i) => (
              <div key={k}>
                <div className="guide-roadmap-h">{[30, 60, 90][i]} days</div>
                <ul className="guide-ul">
                  {b.roadmap[k].map((s, j) => <li key={j}>{s}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </Block>

        {b.nextActions.length > 0 && (
          <Block
            title="Do this week"
            copyText={b.nextActions.map((a) => `- ${a.action}`).join('\n')}
          >
            <ol className="guide-ol">
              {b.nextActions.map((a, i) => (
                <li key={i}>
                  <strong>{a.action}</strong>
                  <div className="t-mdp ink-3" style={{ marginTop: 2 }}>{a.why}</div>
                </li>
              ))}
            </ol>
          </Block>
        )}

        {b.targetOpportunities.length > 0 && (
          <Block title="Opportunities to work" defaultOpen>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              {b.targetOpportunities.map((t, i) => (
                <Link
                  key={i}
                  href={`/explore?topic=${encodeURIComponent(t)}`}
                  className="badge"
                  style={{ background: 'var(--accent-soft)', color: 'var(--accent-text)' }}
                >
                  {t}
                </Link>
              ))}
            </div>
            <Link href="/signals" className="btn btn-primary btn-sm">
              <Icons.bolt size={13} /> Find warm leads in Signals
            </Link>
          </Block>
        )}
      </div>
    </section>
  )
}
