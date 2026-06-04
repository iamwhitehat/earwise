'use client'

import { useEffect, useState } from 'react'
import { Spinner } from './icons'
import { EMPTY_PROFILE, type BusinessProfile } from '@/lib/strategy'

// Self-contained business-profile editor: loads + saves via /api/strategy/profile.
// Grounds the strategist and the Voice engine. Used by Settings.
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

export function BusinessProfileForm() {
  const [profile, setProfile] = useState<BusinessProfile>(EMPTY_PROFILE)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/strategy/profile')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((res) => {
        if (cancelled) return
        if (res?.profile) setProfile(res.profile as BusinessProfile)
        setLoaded(true)
      })
    return () => { cancelled = true }
  }, [])

  function setField(key: keyof BusinessProfile, value: string) {
    setProfile((p) => ({ ...p, [key]: value }))
  }

  async function handleSave() {
    if (saving) return
    setSaving(true)
    setStatus('idle')
    setError(null)
    try {
      const res = await fetch('/api/strategy/profile', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ profile }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((j as { error?: string }).error ?? `Error ${res.status}`)
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
    <section className="section" style={{ marginBottom: 0 }}>
      <div className="section-head">
        <h2>Your business</h2>
        <span className="hint">grounds your positioning, plan, and Voice brief</span>
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
                disabled={!loaded || saving}
              />
            </label>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
          <button type="button" className="btn btn-primary btn-sm" onClick={handleSave} disabled={!loaded || saving}>
            {saving ? <><Spinner size={13} /> Saving…</> : 'Save business'}
          </button>
          <span className="hint">
            {status === 'saved' && <span style={{ color: 'var(--score-high)' }}>Saved</span>}
            {status === 'error' && error && <span style={{ color: 'var(--pain)' }}>{error}</span>}
          </span>
        </div>
      </div>
    </section>
  )
}
