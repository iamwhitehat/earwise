'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Topbar, SubChip, CategoryBadge } from '../../_components/components'
import { Icons, Spinner } from '../../_components/icons'
import { useScanCtx } from '../../_components/scan-provider'
import { useDrawer } from '../../_components/drawer'
import { findFirstMatch } from '@/lib/intent-patterns'
import { CATEGORY_ORDER, type Category } from '@/lib/categories'
import type { MaterializedOpportunity, AdvantageComponents } from '@/lib/advantage'

// Opportunity workspace (REDESIGN-SPEC › Zaslon 2): all the power, scoped to one
// opportunity, with the journey spine + internal tabs. Evidence drills into the
// right Drawer; the rest are progressive.
type EvidencePost = {
  id: string
  subreddit: string
  title: string
  selftext: string
  author: string
  permalink: string
  category: Category
  analyzedAt: number
  tools: string[] | null
  quotes: unknown
  commentsSampled: number | null
}

type Tab = 'evidence' | 'voice' | 'graph' | 'competition' | 'leads' | 'plan'
const TABS: { id: Tab; label: string }[] = [
  { id: 'evidence', label: 'Evidence' },
  { id: 'voice', label: 'Voice' },
  { id: 'graph', label: 'Graph' },
  { id: 'competition', label: 'Competition' },
  { id: 'leads', label: 'Leads' },
  { id: 'plan', label: 'Plan' },
]

const STAGES = ['Signal', 'Validate', 'Offer', 'Reach', 'Convert', 'Learn'] as const

const ADV_LABELS: { key: keyof AdvantageComponents; label: string }[] = [
  { key: 'demand', label: 'Demand' },
  { key: 'monetization', label: 'Monetization' },
  { key: 'momentum', label: 'Momentum' },
  { key: 'whitespace', label: 'Whitespace' },
  { key: 'fitToYou', label: 'Fit to you' },
]

function directionLabel(momentum: number): string {
  if (momentum >= 0.8) return '↑ accelerating'
  if (momentum >= 0.6) return '↑ rising'
  if (momentum >= 0.4) return '→ stable'
  return '↓ cooling'
}

function ago(ts: number): string {
  const d = Date.now() - ts
  if (d < 3_600_000) return `${Math.max(1, Math.floor(d / 60_000))}m`
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h`
  return `${Math.floor(d / 86_400_000)}d`
}

export default function OpportunityWorkspace() {
  const params = useParams<{ topic: string }>()
  const topic = decodeURIComponent(params.topic ?? '')
  const router = useRouter()
  const scan = useScanCtx()
  const drawer = useDrawer()

  const [opp, setOpp] = useState<MaterializedOpportunity | null>(null)
  const [posts, setPosts] = useState<EvidencePost[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('evidence')
  const [showBreakdown, setShowBreakdown] = useState(false)
  const [pursued, setPursued] = useState<'idle' | 'pursued' | 'parked'>('idle')

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch('/api/opportunities').then((r) => (r.ok ? r.json() : { opportunities: [] })).catch(() => ({ opportunities: [] })),
      fetch(`/api/posts-by-topic?topic=${encodeURIComponent(topic)}`).then((r) => (r.ok ? r.json() : [])).catch(() => []),
    ])
      .then(([oppJson, postJson]) => {
        if (cancelled) return
        const list = (oppJson as { opportunities?: MaterializedOpportunity[] }).opportunities ?? []
        setOpp(list.find((o) => o.topic === topic) ?? null)
        setPosts(Array.isArray(postJson) ? (postJson as EvidencePost[]) : [])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [topic])

  // Keyboard 1–6 → tabs (ignore while typing).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const n = Number(e.key)
      if (Number.isInteger(n) && n >= 1 && n <= TABS.length) setTab(TABS[n - 1].id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const grouped = useMemo(() => {
    const map: Record<Category, EvidencePost[]> = { pain_point: [], feature_request: [], tool_complaint: [], other: [] }
    for (const p of posts ?? []) (map[p.category] ?? map.other).push(p)
    return map
  }, [posts])

  const leadCandidates = useMemo(
    () => (posts ?? []).filter((p) => findFirstMatch(`${p.title}\n${p.selftext}`) !== null),
    [posts],
  )

  const addLead = useCallback(async (p: EvidencePost) => {
    const match = findFirstMatch(`${p.title}\n${p.selftext}`)
    await fetch('/api/leads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'post',
        id: p.id,
        post_id: p.id,
        subreddit: p.subreddit,
        permalink: p.permalink,
        author: p.author,
        topic,
        intentType: match?.intentType ?? null,
        category: p.category,
        text: `${p.title}\n${p.selftext}`.trim(),
      }),
    }).catch(() => {})
  }, [topic])

  function openEvidence(p: EvidencePost) {
    drawer.push(<EvidenceDrawer post={p} onAddLead={() => addLead(p)} />, `u/${p.author} · r/${p.subreddit}`)
  }

  async function pursue(kind: 'opportunity_pursued' | 'opportunity_parked') {
    if (!opp) return
    setPursued(kind === 'opportunity_pursued' ? 'pursued' : 'parked')
    const components: AdvantageComponents = {
      demand: opp.demand, monetization: opp.monetization, momentum: opp.momentum,
      whitespace: opp.whitespace, fitToYou: opp.fitToYou,
    }
    await fetch('/api/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entity: 'opportunity', entityId: topic, kind, payload: { topic, components } }),
    }).catch(() => {})
  }

  // Journey spine: Signal is done once we have evidence; Validate is the current
  // move (confirm your offer before mass outreach).
  const currentStage = (posts?.length ?? 0) > 0 ? 1 : 0
  const stageAction: Record<number, () => void> = {
    0: () => setTab('evidence'),
    1: () => setTab('competition'),
    2: () => setTab('voice'),
    3: () => router.push('/pipeline?view=reach'),
    4: () => router.push('/pipeline'),
    5: () => router.push('/insights'),
  }

  return (
    <>
      <Topbar title="Opportunity" posts={scan.posts}>
        <Link href="/today" className="btn btn-ghost btn-sm" style={{ textDecoration: 'none' }}>
          <Icons.chev size={12} className="ws-back-chev" /> Today
        </Link>
      </Topbar>

      <div className="content scroll">
        {loading && (
          <div className="empty" style={{ padding: 40 }}>
            <Spinner size={18} color="var(--ink-3)" /> Loading opportunity…
          </div>
        )}

        {!loading && (
          <>
            {/* Header */}
            <div className="ws-head">
              <div className="ws-head-main">
                <h1 className="ws-title">{topic}</h1>
                <div className="ws-meta">
                  {opp && (
                    <button type="button" className="ws-score" onClick={() => setShowBreakdown((s) => !s)} aria-expanded={showBreakdown} title="Advantage score — tap for the breakdown">
                      <span className="tnum">{(opp.advantage * 10).toFixed(1)}</span>
                      <span className="ws-score-cap">Advantage</span>
                    </button>
                  )}
                  {opp && <span className="ws-dir">{directionLabel(opp.momentum)}</span>}
                  {opp && opp.confirmedSources.length >= 2 && (
                    <span className="ws-sources" title={`Confirmed in: ${opp.confirmedSources.join(', ')}`}>
                      ✦ {opp.confirmedSources.length} sources
                    </span>
                  )}
                  <span className="ws-postcount tnum">{posts?.length ?? 0} posts</span>
                </div>
              </div>
              <div className="ws-actions">
                {pursued === 'pursued' ? (
                  <span className="ws-pursued">✓ Pursuing</span>
                ) : (
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => pursue('opportunity_pursued')}>Pursue</button>
                )}
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTab('leads')}>Draft outreach</button>
                <Link href="/pipeline?view=plan" className="btn btn-ghost btn-sm" style={{ textDecoration: 'none' }}>Add to plan</Link>
                {pursued !== 'parked' && pursued !== 'pursued' && (
                  <button type="button" className="ws-park" onClick={() => pursue('opportunity_parked')}>Park</button>
                )}
              </div>
            </div>

            {opp && showBreakdown && (
              <div className="ws-breakdown">
                {ADV_LABELS.map(({ key, label }) => {
                  const value = opp[key as 'demand']
                  return (
                    <div className="ws-bd-row" key={key}>
                      <span className="ws-bd-label">{label}</span>
                      <span className="ws-bd-bar"><i style={{ width: `${Math.round(value * 100)}%` }} /></span>
                      <span className="ws-bd-val tnum">{Math.round(value * 100)}</span>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Journey spine */}
            <div className="spine" role="list">
              {STAGES.map((s, i) => {
                const state = i < currentStage ? 'done' : i === currentStage ? 'current' : 'upcoming'
                return (
                  <button key={s} type="button" className={`spine-step ${state}`} onClick={stageAction[i]} role="listitem">
                    <span className="spine-dot" aria-hidden="true">{state === 'done' ? '✓' : ''}</span>
                    {s}
                  </button>
                )
              })}
            </div>

            {/* Tabs */}
            <div className="ws-tabs" role="tablist">
              {TABS.map((t, i) => (
                <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`ws-tab${tab === t.id ? ' on' : ''}`} onClick={() => setTab(t.id)}>
                  {t.label}<span className="ws-tab-key">{i + 1}</span>
                </button>
              ))}
            </div>

            {/* Tab panels */}
            {tab === 'evidence' && (
              <div className="ws-panel">
                {(posts?.length ?? 0) === 0 ? (
                  <Empty icon="radar" text="No evidence yet. Run a scan to collect posts for this topic." />
                ) : (
                  CATEGORY_ORDER.filter((c) => grouped[c].length > 0).map((cat) => (
                    <section className="ws-evgroup" key={cat}>
                      <div className="ws-evgroup-head">
                        <CategoryBadge cat={cat} />
                        <span className="ws-evgroup-n tnum">{grouped[cat].length}</span>
                      </div>
                      {grouped[cat].slice(0, 12).map((p) => (
                        <article className="ev-row" key={`${p.subreddit}:${p.id}`}>
                          <button type="button" className="ev-main" onClick={() => openEvidence(p)}>
                            <p className="ev-title">{p.title}</p>
                            <div className="ev-meta">
                              <SubChip sub={p.subreddit} />
                              <span className="ev-age tnum">{ago(p.analyzedAt)} ago</span>
                            </div>
                          </button>
                          <div className="ev-actions">
                            <button type="button" className="ev-act" onClick={() => addLead(p)} title="Add to pipeline">+ lead</button>
                            <a className="ev-act" href={p.permalink} target="_blank" rel="noopener noreferrer" title="Open thread">↗</a>
                          </div>
                        </article>
                      ))}
                    </section>
                  ))
                )}
              </div>
            )}

            {tab === 'voice' && <VoicePanel posts={posts ?? []} />}

            {tab === 'graph' && (
              <div className="ws-panel">
                <Empty icon="sparkles" text="Knowledge graph — collecting data. Deep-scan more posts on this topic and check back." />
              </div>
            )}

            {tab === 'competition' && opp && (
              <div className="ws-panel">
                <div className="ws-stat">
                  <span className="ws-stat-v tnum" style={{ color: 'var(--advantage, #FFC53D)' }}>{Math.round(opp.whitespace * 100)}</span>
                  <span className="ws-stat-k">Whitespace — how open the lane is (higher = less crowded)</span>
                </div>
                <ToolsList posts={posts ?? []} heading="Incumbents mentioned (your competition)" />
              </div>
            )}

            {tab === 'leads' && (
              <div className="ws-panel">
                {leadCandidates.length === 0 ? (
                  <Empty icon="inbox" text="No high-intent posts detected for this topic yet." />
                ) : (
                  <>
                    <div className="ws-panel-head">
                      <span>{leadCandidates.length} high-intent post{leadCandidates.length === 1 ? '' : 's'}</span>
                      <Link href="/leads" className="accent-link" style={{ color: 'var(--accent-text)' }}>Open pipeline →</Link>
                    </div>
                    {leadCandidates.slice(0, 15).map((p) => (
                      <article className="ev-row" key={`lead:${p.id}`}>
                        <button type="button" className="ev-main" onClick={() => openEvidence(p)}>
                          <p className="ev-title">{p.title}</p>
                          <div className="ev-meta"><SubChip sub={p.subreddit} /><span className="ev-age">u/{p.author}</span></div>
                        </button>
                        <div className="ev-actions">
                          <button type="button" className="ev-act" onClick={() => addLead(p)}>+ lead</button>
                        </div>
                      </article>
                    ))}
                  </>
                )}
              </div>
            )}

            {tab === 'plan' && (
              <div className="ws-panel">
                <Empty icon="flag" text="Generate a strategist plan scoped to this opportunity — positioning, ICP, messaging, 30/60/90, next 5 actions." />
                <div style={{ textAlign: 'center' }}>
                  <Link href="/pipeline?view=plan" className="btn btn-primary" style={{ textDecoration: 'none' }}>Open the strategist</Link>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}

function Empty({ icon, text }: { icon: 'radar' | 'sparkles' | 'inbox' | 'flag'; text: string }) {
  const Icon = Icons[icon]
  return (
    <div className="card empty" style={{ marginBottom: 'var(--gap)' }}>
      <span className="e-ico"><Icon size={24} /></span>
      <div>{text}</div>
    </div>
  )
}

function ToolsList({ posts, heading }: { posts: EvidencePost[]; heading: string }) {
  const tools = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of posts) for (const t of p.tools ?? []) counts.set(t, (counts.get(t) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
  }, [posts])
  if (tools.length === 0) return <Empty icon="sparkles" text="Collecting data — deep-scan posts to surface the tools people mention." />
  return (
    <div className="ws-tools">
      <div className="ws-panel-head">{heading}</div>
      <div className="ws-tool-chips">
        {tools.map(([t, n]) => (
          <span key={t} className="ws-tool">{t}<span className="ws-tool-n tnum">{n}</span></span>
        ))}
      </div>
    </div>
  )
}

function VoicePanel({ posts }: { posts: EvidencePost[] }) {
  const quotes = useMemo(() => {
    const out: string[] = []
    for (const p of posts) {
      const qs = p.quotes
      if (Array.isArray(qs)) {
        for (const q of qs) {
          const text = typeof q === 'string' ? q : typeof (q as { text?: unknown })?.text === 'string' ? (q as { text: string }).text : ''
          if (text) out.push(text)
        }
      }
    }
    return out.slice(0, 12)
  }, [posts])
  return (
    <div className="ws-panel">
      <div className="ws-panel-head">
        <span>How buyers describe it</span>
        <Link href="/customer-voice" className="accent-link" style={{ color: 'var(--accent-text)' }}>Open Customer Voice →</Link>
      </div>
      {quotes.length === 0 ? (
        <Empty icon="sparkles" text="No buyer quotes yet — deep-scan comments to mine the exact phrases people use." />
      ) : (
        <ul className="ws-quotes">
          {quotes.map((q, i) => (<li key={i}>“{q}”</li>))}
        </ul>
      )}
      <ToolsList posts={posts} heading="Tools they mention" />
    </div>
  )
}

function EvidenceDrawer({ post, onAddLead }: { post: EvidencePost; onAddLead: () => void }) {
  const [added, setAdded] = useState(false)
  const [copied, setCopied] = useState(false)
  return (
    <div className="ev-drawer">
      <CategoryBadge cat={post.category} />
      <h3 className="ev-drawer-title">{post.title}</h3>
      {post.selftext && <p className="ev-drawer-body">{post.selftext}</p>}
      <div className="ev-drawer-actions">
        <button type="button" className="btn btn-primary btn-sm" disabled={added} onClick={() => { onAddLead(); setAdded(true) }}>
          {added ? '✓ Added to pipeline' : '+ Add lead'}
        </button>
        <a className="btn btn-ghost btn-sm" href={post.permalink} target="_blank" rel="noopener noreferrer">Open thread ↗</a>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={async () => {
            try { await navigator.clipboard.writeText(`${post.title}\n\n${post.selftext}`); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* noop */ }
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  )
}
