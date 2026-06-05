'use client'

import { useEffect, useState } from 'react'
import { Spinner } from './icons'
import type { Project } from '@/lib/projects'

// The niche anchor — the single input that drives the relevance gate. Without
// it, Hot-now can't tell a real buyer from junk and the hero shows off-niche
// noise. Reads/writes the ACTIVE project's niche via /api/projects (PATCH).
export function NicheField() {
  const [niche, setNiche] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle')

  useEffect(() => {
    let cancelled = false
    fetch('/api/projects')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((j: { projects?: Project[]; active?: string } | null) => {
        if (cancelled) return
        const active = j?.projects?.find((p) => p.id === j.active) ?? j?.projects?.[0]
        setNiche(active?.niche ?? '')
        setLoaded(true)
      })
    return () => { cancelled = true }
  }, [])

  async function save() {
    if (saving) return
    setSaving(true)
    setStatus('idle')
    try {
      const res = await fetch('/api/projects', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ niche: niche.trim() }),
      })
      setStatus(res.ok ? 'saved' : 'error')
    } catch {
      setStatus('error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="card" style={{ padding: '18px 20px', marginBottom: 'var(--gap)', borderLeft: '3px solid var(--accent)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
        <strong style={{ fontSize: 14 }}>Your niche</strong>
        <span className="hint">drives which buyers reach your hero — set this first</span>
      </div>
      <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.5 }}>
        One line on what you sell and who you sell to. We use it to screen every signal, so an
        off-niche post never shows up as your &ldquo;hottest buyer&rdquo;.
      </p>
      <textarea
        value={niche}
        disabled={!loaded || saving}
        onChange={(e) => { setNiche(e.target.value); setStatus('idle') }}
        rows={2}
        placeholder="e.g. an MSP/IT-support tool for small managed service providers and sysadmins"
        style={{
          width: '100%', resize: 'vertical', font: 'inherit', fontSize: 13, lineHeight: 1.5,
          color: 'var(--ink)', background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 8, padding: '10px 12px', marginBottom: 12,
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={!loaded || saving || niche.trim().length < 2}>
          {saving ? <><Spinner size={13} /> Saving…</> : 'Save niche'}
        </button>
        {status === 'saved' && <span style={{ fontSize: 13, color: 'var(--score-high)' }}>Saved — your hero will refresh on next scan.</span>}
        {status === 'error' && <span style={{ fontSize: 13, color: 'var(--pain)' }}>Couldn&apos;t save — try again.</span>}
      </div>
    </section>
  )
}
