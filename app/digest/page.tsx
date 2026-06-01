'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Icons, Spinner } from '../_components/icons'
import { useScanCtx } from '../_components/scan-provider'
import { SynthModelSelect, Topbar } from '../_components/components'
import { useSynthModel } from '@/lib/use-synth-model'
import type { DigestBrief, StoredDigest } from '@/lib/digest-types'
import type { Alert } from '@/lib/alerts'

function formatAgo(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

export default function DigestPage() {
  const scan = useScanCtx()
  const { tier, setTier } = useSynthModel()
  const [digest, setDigest] = useState<StoredDigest | null>(null)
  const [brief, setBrief] = useState<DigestBrief | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/digest')
      .then((r) => (r.ok ? r.json() : null))
      .then((json: StoredDigest | null) => {
        if (cancelled || !json) return
        setDigest(json)
        setBrief(json.brief)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  async function handleRun() {
    if (running) return
    setRunning(true)
    setError(null)
    try {
      const res = await fetch('/api/digest/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tier }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`)
      setBrief((json as { brief: DigestBrief }).brief)
      setDigest({ id: 0, period: (json as { brief: DigestBrief }).brief.weekStart, brief: (json as { brief: DigestBrief }).brief, generatedAt: Date.now() })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generate failed')
    } finally {
      setRunning(false)
    }
  }

  return (
    <>
      <Topbar title="Digest" posts={scan.posts}>
        <SynthModelSelect value={tier} onChange={setTier} disabled={running} />
        <button type="button" className="btn btn-primary btn-sm" onClick={handleRun} disabled={running}>
          {running ? (
            <>
              <Spinner size={13} /> Building…
            </>
          ) : (
            <>
              <Icons.sparkles size={14} /> {brief ? 'Regenerate' : 'Generate now'}
            </>
          )}
        </button>
      </Topbar>

      <div className="content scroll">
        {error && (
          <div
            className="card"
            style={{ padding: '14px 17px', marginBottom: 'var(--gap)', background: 'var(--pain-bg)', borderColor: 'oklch(0.9 0.05 22)', color: 'var(--ink-2)', fontSize: 13 }}
          >
            <strong style={{ color: 'var(--pain)' }}>Error:</strong> {error}
          </div>
        )}

        {!brief && !error && (
          <div className="card empty fade-in">
            <span className="e-ico">
              <Icons.bell size={28} />
            </span>
            <div>
              No digest yet. Click <strong>Generate now</strong> for your weekly State of your
              Market — new opportunities, accelerating trends, fresh leads, the 3 moves to make,
              and ready-to-send drafts. Schedule it via <code>POST /api/cron/run</code> (see SETUP §5).
            </div>
          </div>
        )}

        {brief && (
          <>
            <div className="card fade-in" style={{ padding: '12px 16px', marginBottom: 'var(--gap)', display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>
                State of your market
              </span>
              <span className="t-mdp ink-3">week of {brief.weekStart}</span>
              {digest && <span className="t-md ink-4" style={{ marginLeft: 'auto' }}>generated {formatAgo(digest.generatedAt)} · {brief.postCount} posts</span>}
            </div>

            {brief.alerts.length > 0 && <AlertsBlock alerts={brief.alerts} />}

            {brief.moves.length > 0 && (
              <Section title="3 moves to make this week">
                <ol className="guide-ol">
                  {brief.moves.map((m, i) => (
                    <li key={i}>
                      <strong>{m.move}</strong>
                      <div className="t-mdp ink-3" style={{ marginTop: 2 }}>{m.why}</div>
                    </li>
                  ))}
                </ol>
              </Section>
            )}

            {brief.newOpportunities.length > 0 && (
              <Section title="Top opportunities">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {brief.newOpportunities.map((o, i) => (
                    <Link key={i} href={`/explore?topic=${encodeURIComponent(o.topic)}`} className="badge" style={{ background: 'var(--accent-soft)', color: 'var(--accent-text)' }} title={`${o.posts} posts · confirmed in ${o.confirmedSources.length} sources`}>
                      {o.topic}
                      {o.advantage > 0 && <span className="tnum" style={{ opacity: 0.7 }}>&nbsp;{Math.round(o.advantage * 100)}</span>}
                    </Link>
                  ))}
                </div>
              </Section>
            )}

            {brief.predictions.length > 0 && (
              <Section title="About to spike" hint="predicted momentum">
                <ul className="guide-ul">
                  {brief.predictions.map((p, i) => (
                    <li key={i}>
                      <strong>{p.topic}</strong>{' '}
                      <span className="t-mdp ink-3">
                        {p.weeklyCounts.join(' → ')} → ~{p.projectedNext}
                        {p.trend === 'spiking' ? ' 🚀' : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {brief.acceleratingTrends.length > 0 && (
              <Section title="Accelerating trends">
                <ul className="guide-ul">
                  {brief.acceleratingTrends.map((t, i) => (
                    <li key={i}>
                      <strong>{t.topic}</strong> <span className="t-mdp ink-3">{t.weeklyCounts.join(' → ')}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {brief.freshLeads.length > 0 && (
              <Section title="Fresh high-intent leads" hint={<Link href="/signals" className="accent-link" style={{ color: 'var(--accent-text)' }}>open Signals →</Link>}>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {brief.freshLeads.map((l, i) => (
                    <li key={i}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                        <span className="t-mdp" style={{ fontWeight: 600, color: 'var(--ink)' }}>u/{l.author}</span>
                        <span className="sub-chip">r/{l.subreddit}</span>
                        <span className="badge" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--ink-2)' }}>{l.intentType}</span>
                        <a href={l.permalink} target="_blank" rel="noopener noreferrer" className="accent-link" style={{ color: 'var(--accent-text)', marginLeft: 'auto' }}>view ↗</a>
                      </div>
                      <p className="t-mdp ink-2" style={{ margin: '3px 0 0', lineHeight: 1.5 }}>{l.excerpt}</p>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {brief.drafts.length > 0 && (
              <Section title="Ready-to-send drafts">
                <ul className="msg-list">
                  {brief.drafts.map((d, i) => (
                    <li className="msg-asset" key={i}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                        <div style={{ flex: 1 }}>
                          <div className="t-xs ink-4" style={{ marginBottom: 4 }}>
                            to u/{d.to} in r/{d.subreddit} ·{' '}
                            <a href={d.permalink} target="_blank" rel="noopener noreferrer" className="accent-link" style={{ color: 'var(--accent-text)' }}>open thread ↗</a>
                          </div>
                          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: 'var(--ink)', whiteSpace: 'pre-wrap' }}>{d.text}</p>
                        </div>
                        <CopyBtn text={d.text} />
                      </div>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
          </>
        )}
      </div>
    </>
  )
}

function Section({ title, hint, children }: { title: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="section" style={{ marginBottom: 'var(--gap)' }}>
      <div className="section-head">
        <h2>{title}</h2>
        {hint && <span className="hint">{hint}</span>}
      </div>
      <div className="card" style={{ padding: 'var(--pad)' }}>{children}</div>
    </section>
  )
}

function AlertsBlock({ alerts }: { alerts: Alert[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 'var(--gap)' }}>
      {alerts.map((a, i) => {
        const high = a.severity === 'high'
        return (
          <div
            key={i}
            className="card fade-in"
            style={{
              padding: '10px 14px',
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              fontSize: 13,
              color: 'var(--ink-2)',
              background: high ? 'var(--pain-bg)' : 'var(--tool-bg)',
              borderColor: high ? 'oklch(0.9 0.05 22)' : 'oklch(0.85 0.08 65)',
            }}
          >
            <span style={{ color: high ? 'var(--pain)' : 'var(--tool)', flexShrink: 0 }}>
              <Icons.alert size={14} />
            </span>
            {a.message}
          </div>
        )
      })}
    </div>
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
