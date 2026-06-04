'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ExportButtons } from './components'
import { Icons, Spinner } from './icons'
import { SignalCard, type Signal } from './signal-card'
import { INTENT_TYPES, INTENT_TYPE_LABEL, type IntentType } from '@/lib/intent-patterns'
import { leadExternalId, type Lead } from '@/lib/leads'

type IntentFilter = 'all' | IntentType
type AgeFilter = 'all' | '24h' | 'week'

const AGE_LABEL: Record<AgeFilter, string> = {
  '24h': 'Last 24 hours',
  week: 'Last 7 days',
  all: 'All time',
}

const DEFAULT_SUB = 'all'
const DEFAULT_INTENT: IntentFilter = 'all'
const DEFAULT_AGE: AgeFilter = 'week'

const INTENT_VALUES = new Set<string>(['all', ...INTENT_TYPES])
const AGE_VALUES = new Set<string>(['24h', 'week', 'all'])
const SUB_RE = /^[a-z0-9_]{2,21}$/i

function parseSub(s: string | null): string {
  if (!s) return DEFAULT_SUB
  if (s === 'all') return 'all'
  if (SUB_RE.test(s)) return s
  return DEFAULT_SUB
}
function parseIntent(s: string | null): IntentFilter {
  return s && INTENT_VALUES.has(s) ? (s as IntentFilter) : DEFAULT_INTENT
}
function parseAge(s: string | null): AgeFilter {
  return s && AGE_VALUES.has(s) ? (s as AgeFilter) : DEFAULT_AGE
}

// The Signal feed, extracted from app/signals/page.tsx as a tab of the Home
// surface. Filters live in the URL (?sub/intent/age) alongside the Home tab's
// ?view=signals — updateParam preserves all existing params (including view),
// so tweaking a filter never snaps the tab back to Today.
export function SignalsView() {
  const router = useRouter()
  const sp = useSearchParams()

  const subFilter = parseSub(sp.get('sub'))
  const intentFilter = parseIntent(sp.get('intent'))
  const ageFilter = parseAge(sp.get('age'))

  const updateParam = useCallback(
    (key: 'sub' | 'intent' | 'age', value: string, defaultValue: string) => {
      const next = new URLSearchParams(sp.toString())
      if (value === defaultValue) next.delete(key)
      else next.set(key, value)
      // Keep the Home tab pinned to Signals (the URL carries ?view=signals).
      next.set('view', 'signals')
      router.replace(`/today?${next.toString()}`, { scroll: false })
    },
    [router, sp],
  )

  const [signals, setSignals] = useState<Signal[]>([])
  const [subs, setSubs] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pipelineIds, setPipelineIds] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    let cancelled = false
    fetch('/api/leads')
      .then(async (res) => {
        if (!res.ok) return
        const json = await res.json()
        if (cancelled) return
        const ids = ((json as { leads?: Lead[] }).leads ?? []).map((l) => l.externalId)
        setPipelineIds(new Set(ids))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const markInPipeline = useCallback((externalId: string) => {
    setPipelineIds((prev) => {
      const next = new Set(prev)
      next.add(externalId)
      return next
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ intent: intentFilter, age: ageFilter })
    if (subFilter !== 'all') params.set('sub', subFilter)
    fetch(`/api/signals?${params.toString()}`)
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`)
        if (cancelled) return
        const payload = json as { signals: Signal[]; subs?: string[] }
        setSignals(payload.signals)
        if (subFilter === 'all') setSubs(payload.subs ?? [])
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [subFilter, intentFilter, ageFilter])

  const counts = useMemo(() => {
    const c = { post: 0, comment: 0 }
    for (const s of signals) c[s.kind]++
    return c
  }, [signals])

  return (
    <>
      <div className="signals-filters">
        <span className="pps">
          <span>Sub</span>
          <select
            value={subFilter}
            onChange={(e) => updateParam('sub', e.target.value, DEFAULT_SUB)}
            disabled={loading || subs.length === 0}
          >
            <option value="all">All subs</option>
            {subs.map((s) => (
              <option key={s} value={s}>r/{s}</option>
            ))}
          </select>
        </span>
        <span className="pps">
          <span>Intent</span>
          <select
            value={intentFilter}
            onChange={(e) => updateParam('intent', e.target.value, DEFAULT_INTENT)}
            disabled={loading}
          >
            <option value="all">All intents</option>
            {INTENT_TYPES.map((it) => (
              <option key={it} value={it}>{INTENT_TYPE_LABEL[it]}</option>
            ))}
          </select>
        </span>
        <span className="pps">
          <span>Age</span>
          <select
            value={ageFilter}
            onChange={(e) => updateParam('age', e.target.value, DEFAULT_AGE)}
            disabled={loading}
          >
            {(['24h', 'week', 'all'] as AgeFilter[]).map((a) => (
              <option key={a} value={a}>{AGE_LABEL[a]}</option>
            ))}
          </select>
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-3)' }}>
          {loading ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Spinner size={11} color="var(--ink-3)" /> Loading signals…
            </span>
          ) : (
            <>
              <span className="tnum" style={{ color: 'var(--ink)', fontWeight: 500 }}>{signals.length}</span>{' '}
              signal{signals.length === 1 ? '' : 's'} ·{' '}
              <span className="tnum">{counts.post}</span> post{counts.post === 1 ? '' : 's'} ·{' '}
              <span className="tnum">{counts.comment}</span> comment{counts.comment === 1 ? '' : 's'}
            </>
          )}
        </span>
        <ExportButtons
          filenameStem="signals"
          disabled={loading || signals.length === 0}
          build={() => ({
            headers: ['kind', 'subreddit', 'author', 'intent', 'matched_phrase', 'category', 'topic', 'age_hours', 'permalink', 'text'],
            rows: signals.map((s) => [
              s.kind,
              s.subreddit,
              s.author,
              s.intentType,
              s.matchedPhrase,
              s.category,
              s.topic ?? '',
              ((Date.now() - s.analyzedAt) / 3_600_000).toFixed(1),
              s.permalink,
              s.text,
            ]),
          })}
        />
      </div>

      {error && (
        <div
          className="card"
          style={{ padding: '14px 17px', marginBottom: 'var(--gap)', background: 'var(--pain-bg)', borderColor: 'oklch(0.9 0.05 22)', color: 'var(--ink-2)', fontSize: 13 }}
        >
          <strong style={{ color: 'var(--pain)' }}>Error:</strong> {error}
        </div>
      )}

      {!loading && !error && signals.length === 0 && (
        <div className="card empty fade-in">
          <span className="e-ico"><Icons.bolt size={26} /></span>
          <div>
            No high-intent signals match these filters. Try widening the age window, switching
            intent, or running a scan from the sidebar to collect fresh posts.
          </div>
        </div>
      )}

      {!error && signals.length > 0 && (
        <div className="signals-list">
          {signals.map((s) => (
            <SignalCard
              key={`${s.kind}:${s.id}`}
              signal={s}
              inPipeline={pipelineIds.has(leadExternalId(s.kind, s.id))}
              onAdded={markInPipeline}
            />
          ))}
        </div>
      )}
    </>
  )
}
