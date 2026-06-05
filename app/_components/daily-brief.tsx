'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useScanCtx } from './scan-provider'
import { buildDailyTasks, allDone as allTasksDone, type DailyTask } from '@/lib/daily-brief'
import { useDailyBrief } from '@/lib/use-daily-brief'
import type { HotSignal } from '@/lib/hot-signals'
import type { MaterializedOpportunity } from '@/lib/advantage'

// Earwise — Daily Brief / Today (handoff daily-brief-app.jsx). The discipline-proof
// rail: a system-written list of today's moves. Work it top to bottom → progress
// fills → finish line → "Generate new moves" refills. Reply moves come from real
// hot-signals (open = draft the reply); content moves route to the real screens.
// Streak + per-day completion via the existing useDailyBrief hook.
const JSON_HEADERS = { 'content-type': 'application/json' }
const KIND_GLYPH: Record<string, string> = { publish: '✎', blog: '¶', voice: '◐', scan: '⟳' }
const KIND_BOX: Record<string, string> = { publish: 'box pub', blog: 'box pub', voice: 'box pub', scan: 'box scn' }
type Toast = { id: number; kind: string; msg: string }

// Cache the brief's data across navigations so switching screens doesn't refetch
// /api/hot-signals (which re-runs the relevance classification → wasted tokens).
// Refreshed on demand ("Generate new moves") or after the TTL.
let briefCache: { hotSignals: HotSignal[]; topOpp: MaterializedOpportunity | null; at: number } | null = null
const BRIEF_TTL_MS = 10 * 60_000

export function DailyBrief() {
  const router = useRouter()
  const scan = useScanCtx()
  const { hydrated, streak, localDone, markLocal, recordBriefComplete } = useDailyBrief()

  const [hotSignals, setHotSignals] = useState<HotSignal[] | null>(null)
  const [topOpp, setTopOpp] = useState<MaterializedOpportunity | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [showFinish, setShowFinish] = useState(false)

  const [toasts, setToasts] = useState<Toast[]>([])
  const toastId = useRef(0)
  const push = useCallback((kind: string, msg: string) => {
    const id = ++toastId.current
    setToasts((t) => [...t, { id, kind, msg }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600)
  }, [])

  const load = useCallback((force = false) => {
    // Reuse the cached batch across navigations unless forced or stale.
    if (!force && briefCache && Date.now() - briefCache.at < BRIEF_TTL_MS) {
      setHotSignals(briefCache.hotSignals)
      setTopOpp(briefCache.topOpp)
      return
    }
    setHotSignals(null)
    Promise.all([
      fetch('/api/hot-signals?window=24h').then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch('/api/opportunities').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([hot, opps]) => {
      const hs = (hot as { signals?: HotSignal[] } | null)?.signals ?? []
      const to = (opps as { opportunities?: MaterializedOpportunity[] } | null)?.opportunities?.[0] ?? null
      briefCache = { hotSignals: hs, topOpp: to, at: Date.now() }
      setHotSignals(hs)
      setTopOpp(to)
    })
  }, [])
  useEffect(() => { load() }, [load])

  const tasks: DailyTask[] | null = useMemo(() => {
    if (hotSignals === null) return null
    const base = buildDailyTasks({ hotSignals, topOpportunity: topOpp, leadStatus: new Map(), localDone: new Set() })
    const content: DailyTask[] = [
      { id: 'blog', kind: 'blog', title: 'Outline a blog post', meta: 'from your top opportunity', href: '/blog', done: false },
      { id: 'voice', kind: 'voice', title: 'Mine buyer phrases', meta: 'for your swipe file', href: '/buyer-voice', done: false },
    ]
    return [...base, ...content].map((t) => ({ ...t, done: localDone.has(t.id) }))
  }, [hotSignals, topOpp, localDone])

  const completed = tasks?.filter((t) => t.done).length ?? 0
  const total = tasks?.length ?? 0
  const briefDone = tasks ? allTasksDone(tasks) : false

  useEffect(() => {
    if (briefDone) {
      recordBriefComplete()
      const tm = setTimeout(() => setShowFinish(true), 350)
      return () => clearTimeout(tm)
    }
    setShowFinish(false)
  }, [briefDone, recordBriefComplete])

  function check(task: DailyTask) {
    if (task.done) return
    markLocal(task.id)
    setFlash(task.id)
    setTimeout(() => setFlash((f) => (f === task.id ? null : f)), 560)
  }

  async function draftReply(s: HotSignal) {
    try {
      const lr = await fetch('/api/leads', {
        method: 'POST', headers: JSON_HEADERS,
        body: JSON.stringify({ kind: s.kind, id: s.id, post_id: s.post_id, subreddit: s.subreddit, permalink: s.permalink, author: s.author, topic: s.topic, intentType: s.intentType, category: s.category, text: s.text }),
      })
      const lj = (await lr.json()) as { lead?: { id?: number; openerDraft?: string | null } }
      if (lj.lead?.id && !lj.lead.openerDraft) {
        await fetch(`/api/leads/${lj.lead.id}/opener`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ action: 'generate' }) })
      }
    } catch { /* the lead/opener will reconcile later */ }
  }

  function open(task: DailyTask) {
    if (task.done) return
    check(task)
    if (task.kind === 'reply' && task.signal) {
      void draftReply(task.signal)
      push('reply →', `Drafting u/${task.signal.author} → Drafts`)
    } else if (task.kind === 'publish') {
      push('post →', 'Opening the opportunity to draft a post…')
      router.push('/demand')
    } else if (task.kind === 'blog') {
      router.push('/blog')
    } else if (task.kind === 'voice') {
      router.push('/buyer-voice')
    } else if (task.kind === 'scan') {
      scan.scanAll()
      push('scan', 'Reading your sources for fresh demand…')
    }
  }

  function generateNewMoves() {
    setShowFinish(false)
    load(true)
    push('↻ refreshed', 'Pulled a fresh batch of moves')
  }

  return (
    <div className="ew">
      <div className="main-wrap">
        <div className="db-head">
          <div>
            <div className="greet-h">Today&apos;s moves</div>
            <div className="greet-sub">Work the list top to bottom. Clear it to lock your streak.</div>
          </div>
          {hydrated && streak > 0 && <span className="streak"><span className="fl">🔥</span>{streak}-day streak</span>}
        </div>

        {tasks === null ? (
          <div className="db-loading"><span className="spin" /> Writing today&apos;s moves…</div>
        ) : (
          <>
            {total > 1 && (
              <div className="progress">
                <span>{completed}/{total}</span>
                <div className="track"><i style={{ width: `${(completed / total) * 100}%` }} /></div>
              </div>
            )}

            {tasks.map((task, i) => {
              const boxClass = KIND_BOX[task.kind] || 'box'
              const glyph = task.done ? '✓' : task.kind === 'reply' ? i + 1 : (KIND_GLYPH[task.kind] || i + 1)
              return (
                <div className={`task${task.done ? ' done' : ''}${flash === task.id ? ' flash' : ''}`} key={task.id}>
                  <button type="button" className={`${boxClass}${task.done ? ' done' : ''}`} onClick={() => check(task)} disabled={task.done} aria-label={task.done ? 'completed' : 'mark done'}>{glyph}</button>
                  <div className="txt"><b>{task.title}</b> <span className="meta">· {task.meta}</span></div>
                  <button type="button" className={`go${task.done ? ' dn' : ''}`} onClick={() => open(task)} disabled={task.done}>{task.done ? 'Done' : 'Open →'}</button>
                </div>
              )
            })}

            {showFinish ? (
              <div className="finish">
                <div className="ck">✓</div>
                <h3>List cleared.</h3>
                <p>You worked every move. Generate a fresh batch to keep going, or call it — your streak&apos;s locked in.</p>
                <div className="pillrow">
                  <button type="button" className="fpill prime" onClick={generateNewMoves}>↻ Generate new moves</button>
                  <span className="fpill">🔥 {streak}-day streak</span>
                </div>
              </div>
            ) : (
              <div className="doneline">
                Clear all {total} → <b>list done</b>, then generate fresh moves. A real end, on demand.
              </div>
            )}
          </>
        )}
      </div>

      <div className="toast-wrap">
        {toasts.map((t) => <div className="toast" key={t.id}><span className="ti">{t.kind}</span><span>{t.msg}</span></div>)}
      </div>
    </div>
  )
}
