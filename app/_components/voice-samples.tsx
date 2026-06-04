'use client'

import { useEffect, useState } from 'react'
import { Spinner } from './icons'

// The founder's voice samples. Paste 3–5 real replies; 1–2 are injected as the
// style anchor for every generated opener/reply (lib/voice.ts). Self-contained:
// loads + saves its own state. Shared by Settings and the Plan view.
const MAX_SAMPLES = 5
const VOICE_PLACEHOLDER =
  `Paste 3–5 of your own real Reddit replies, separated by a blank line.\n\n` +
  `Example of the register to match:\n\n` +
  `The tool isn't the problem — intake is. Email's handled by anything; phone and text off a personal number is what nothing solves cleanly.`

export function splitSamples(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_SAMPLES)
}

export function VoiceSamples() {
  const [text, setText] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/voice-samples')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((res) => {
        if (cancelled) return
        const samples = (res?.samples as string[] | undefined) ?? []
        if (samples.length > 0) setText(samples.join('\n\n'))
        setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const samples = splitSamples(text)

  async function handleSave() {
    if (saving) return
    setSaving(true)
    setStatus('idle')
    setError(null)
    try {
      const res = await fetch('/api/voice-samples', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ samples }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((j as { error?: string }).error ?? `Error ${res.status}`)
      const saved = ((j as { samples?: string[] }).samples ?? samples)
      setText(saved.join('\n\n'))
      setStatus('saved')
      setTimeout(() => setStatus('idle'), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
      setStatus('error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="section" style={{ marginTop: 'var(--gap)', marginBottom: 0 }}>
      <div className="section-head">
        <h2>Your voice</h2>
        <span className="hint">your real replies anchor every generated draft</span>
      </div>
      <div className="card" style={{ padding: 'var(--pad)' }}>
        <textarea
          value={text}
          placeholder={VOICE_PLACEHOLDER}
          onChange={(e) => setText(e.target.value)}
          disabled={!loaded || saving}
          rows={9}
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
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
          <button type="button" className="btn btn-primary btn-sm" onClick={handleSave} disabled={!loaded || saving}>
            {saving ? <><Spinner size={13} /> Saving…</> : 'Save voice'}
          </button>
          <span className="hint">
            {samples.length}/{MAX_SAMPLES} {samples.length === 1 ? 'sample' : 'samples'}
            {status === 'saved' && <span style={{ color: 'var(--score-high)', marginLeft: 8 }}>Saved</span>}
            {status === 'error' && error && <span style={{ color: 'var(--pain)', marginLeft: 8 }}>{error}</span>}
          </span>
        </div>
      </div>
    </section>
  )
}
