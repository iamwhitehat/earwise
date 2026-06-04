'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Topbar, SynthModelSelect } from '../_components/components'
import { useScanCtx } from '../_components/scan-provider'
import { CustomerVoiceView } from '../_components/customer-voice-view'
import { Icons, Spinner } from '../_components/icons'
import { useSynthModel } from '@/lib/use-synth-model'
import type { VoiceBrief } from '@/lib/voice-brief'

// Voice — the headline surface: how to talk about your product, in your buyers'
// own words. Two tight views: Positioning (the distilled brief) and Words (the
// buyer-language explorer + messaging kit). URL-persisted like Pipeline.
type View = 'positioning' | 'words'
const VIEWS: { id: View; label: string }[] = [
  { id: 'positioning', label: 'Positioning' },
  { id: 'words', label: 'Words' },
]

function VoiceInner() {
  const scan = useScanCtx()
  const params = useSearchParams()
  const view: View = params.get('view') === 'words' ? 'words' : 'positioning'

  return (
    <>
      <Topbar title="Voice" posts={scan.posts}>
        <nav className="seg" aria-label="Voice view">
          {VIEWS.map((v) => (
            <Link
              key={v.id}
              href={`/voice?view=${v.id}`}
              className={`seg-btn${view === v.id ? ' on' : ''}`}
              aria-current={view === v.id ? 'page' : undefined}
            >
              {v.label}
            </Link>
          ))}
        </nav>
      </Topbar>

      <div className="content scroll">
        {view === 'positioning' ? <PositioningView /> : <CustomerVoiceView />}
      </div>
    </>
  )
}

function PositioningView() {
  const { tier, setTier } = useSynthModel()
  const [brief, setBrief] = useState<VoiceBrief | null>(null)
  const [meta, setMeta] = useState<{ model?: string; generatedAt?: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/voice')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((res) => {
        if (cancelled) return
        if (res?.brief) {
          setBrief(res.brief as VoiceBrief)
          setMeta({ model: res.model, generatedAt: res.generatedAt })
        }
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  async function refresh() {
    if (refreshing) return
    setRefreshing(true)
    setError(null)
    try {
      const res = await fetch('/api/voice/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tier }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`)
      setBrief(json.brief as VoiceBrief)
      setMeta({ model: json.model, generatedAt: json.generatedAt })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh failed')
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <>
      <div className="pipe-actions" style={{ gap: 10, alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--gap)' }}>
        <span className="hint">
          {meta?.generatedAt
            ? `Distilled ${formatAgo(meta.generatedAt)}${modelLabel(meta.model) ? ` · ${modelLabel(meta.model)}` : ''}`
            : 'Your positioning — in your buyers’ own words'}
        </span>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {brief && <CopyButton text={briefToText(brief)} label="Copy all" />}
          <SynthModelSelect value={tier} onChange={setTier} disabled={refreshing} />
          <button type="button" className="btn btn-primary btn-sm" onClick={refresh} disabled={refreshing}>
            {refreshing ? <><Spinner size={13} /> Distilling…</> : <><Icons.sparkles size={14} /> {brief ? 'Re-distill' : 'Distill voice'}</>}
          </button>
        </div>
      </div>

      {error && (
        <div className="card" style={{ padding: '14px 17px', marginBottom: 'var(--gap)', background: 'var(--pain-bg)', color: 'var(--ink-2)', fontSize: 13 }}>
          <strong style={{ color: 'var(--pain)' }}>Error:</strong> {error}
        </div>
      )}

      {loading && (
        <div className="card" style={{ padding: 'var(--pad)' }}>
          <div className="skel" style={{ height: 14, width: '40%', marginBottom: 8 }} />
          <div className="skel" style={{ height: 70 }} />
        </div>
      )}

      {!loading && !brief && !error && (
        <div className="card empty fade-in">
          <span className="e-ico"><Icons.sparkles size={28} /></span>
          <div>
            Distill your <strong>positioning</strong> — one sharp line, the angles that land, and
            paste-ready copy, all in your buyers&apos; own words. Needs a Customer Voice run first
            (<Link href="/voice?view=words" style={{ color: 'var(--accent-text)', textDecoration: 'underline' }}>Words → Refresh</Link>), then click{' '}
            <strong>Distill voice</strong>.
          </div>
        </div>
      )}

      {brief && <BriefView brief={brief} />}
    </>
  )
}

function BriefView({ brief }: { brief: VoiceBrief }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap)' }}>
      {brief.positioningLine && (
        <section className="card" style={{ padding: 'var(--pad)', borderLeft: '3px solid var(--accent)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
            <span className="t-sm ink-3" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Positioning</span>
            <CopyButton text={brief.positioningLine} />
          </div>
          <p style={{ margin: 0, fontSize: 21, lineHeight: 1.4, letterSpacing: '-0.015em', color: 'var(--ink)' }}>
            {brief.positioningLine}
          </p>
        </section>
      )}

      {brief.angles.length > 0 && (
        <section className="section" style={{ margin: 0 }}>
          <div className="section-head"><h2>Angles that land</h2><span className="hint">in their words</span></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {brief.angles.map((a, i) => (
              <div key={i} className="card" style={{ padding: 'var(--pad)' }}>
                <strong style={{ fontSize: 14 }}>{a.angle}</strong>
                {a.whyItLands && <div className="t-mdp ink-3" style={{ marginTop: 3 }}>{a.whyItLands}</div>}
                {a.exactWords.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                    {a.exactWords.map((w, j) => (
                      <span key={j} className="badge" style={{ background: 'var(--surface-2)', color: 'var(--ink-2)' }}>“{w}”</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {brief.snippets.length > 0 && (
        <section className="section" style={{ margin: 0 }}>
          <div className="section-head"><h2>Copy you can paste</h2></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {brief.snippets.map((s, i) => (
              <div key={i} className="card" style={{ padding: 'var(--pad)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
                  <span className="badge">{s.label || 'snippet'}</span>
                  <CopyButton text={s.text} />
                </div>
                <p style={{ whiteSpace: 'pre-wrap', margin: 0, lineHeight: 1.55, color: 'var(--ink)' }}>{s.text}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
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
      {copied ? <span style={{ color: 'var(--score-high)' }}>Copied</span> : label}
    </button>
  )
}

// Friendly tier name instead of the raw model id (no plumbing leaking to users).
function modelLabel(model?: string): string {
  if (!model) return ''
  if (model.includes('haiku')) return 'Fast'
  if (model.includes('opus')) return 'Max'
  if (model.includes('sonnet')) return 'Balanced'
  return model
}

function formatAgo(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

// The whole brief as plain text, for the "Copy all" action.
function briefToText(b: VoiceBrief): string {
  const out: string[] = []
  if (b.positioningLine) out.push(`POSITIONING\n${b.positioningLine}`)
  if (b.angles.length > 0) {
    out.push('\nANGLES')
    for (const a of b.angles) {
      out.push(`- ${a.angle}${a.whyItLands ? ` — ${a.whyItLands}` : ''}`)
      if (a.exactWords.length > 0) out.push(`  words: ${a.exactWords.map((w) => `"${w}"`).join(', ')}`)
    }
  }
  if (b.snippets.length > 0) {
    out.push('\nCOPY')
    for (const s of b.snippets) out.push(`[${s.label || 'snippet'}]\n${s.text}`)
  }
  return out.join('\n')
}

export default function VoicePage() {
  return (
    <Suspense fallback={null}>
      <VoiceInner />
    </Suspense>
  )
}
