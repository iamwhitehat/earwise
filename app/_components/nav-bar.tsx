'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useScanCtx, useWatchlistCtx } from './scan-provider'
import { useSidebarCtx } from './sidebar-provider'

// The app shell sidebar — a faithful port of the handoff shell.jsx (spec §5).
// Today + a Demand⇄Distribution stage toggle (numbered) + the active stage's
// destinations + a scan-row with a settings gear. Nothing else: no project
// switcher, search bar, or theme toggle — those aren't in the design.
type Dest = { id: string; ic: IconName; label: string; href: string }

const DEMAND_DESTS: Dest[] = [
  { id: 'opportunities', ic: 'opportunities', label: 'Opportunities', href: '/demand' },
  { id: 'buyervoice', ic: 'buyervoice', label: 'Buyer Voice', href: '/buyer-voice' },
]
const DIST_DESTS: Dest[] = [
  { id: 'warmleads', ic: 'warmleads', label: 'Warm leads', href: '/warm-leads' },
  { id: 'drafts', ic: 'drafts', label: 'Drafts', href: '/drafts' },
]
const MOBILE_TABS: { id: string; ic: IconName; label: string; href: string; stage?: string }[] = [
  { id: 'today', ic: 'today', label: 'Today', href: '/today' },
  { id: 'opportunities', ic: 'opportunities', label: 'Demand', href: '/demand', stage: 'demand' },
  { id: 'warmleads', ic: 'warmleads', label: 'Leads', href: '/warm-leads' },
  { id: 'drafts', ic: 'drafts', label: 'Drafts', href: '/drafts' },
]

// pathname → active screen id
function activeId(pathname: string): string {
  if (pathname === '/' || pathname.startsWith('/today')) return 'today'
  if (pathname.startsWith('/demand')) return 'opportunities'
  if (pathname.startsWith('/buyer-voice')) return 'buyervoice'
  if (pathname.startsWith('/warm-leads')) return 'warmleads'
  if (pathname.startsWith('/drafts')) return 'drafts'
  if (pathname.startsWith('/sources')) return 'sources'
  return ''
}
const STAGE_OF: Record<string, 'demand' | 'distribution' | undefined> = {
  opportunities: 'demand', buyervoice: 'demand', warmleads: 'distribution', drafts: 'distribution',
}

export function NavBar() {
  const pathname = usePathname()
  const { watchlist } = useWatchlistCtx()
  const scan = useScanCtx()
  const { closeSidebar } = useSidebarCtx()

  const active = activeId(pathname)
  const stage = STAGE_OF[active]
  const dests = stage === 'demand' ? DEMAND_DESTS : stage === 'distribution' ? DIST_DESTS : null
  const lastScan = formatLastScan(scan.lastScanAt)

  // Live scan info: posts found so far + the subreddit currently being read.
  const postsFound: number = scan.posts?.length ?? 0
  const order: string[] = scan.order ?? []
  const buckets: Record<string, { stage?: { kind: string; current?: number; total?: number } }> = scan.buckets ?? {}
  let activeSub = ''
  for (const s of order) {
    const st = buckets[s]?.stage
    if (st && st.kind !== 'fetching' && st.kind !== 'failed') { activeSub = s; break }
  }
  const st = activeSub ? buckets[activeSub]?.stage : undefined
  const stageStr =
    st && typeof st.current === 'number' && typeof st.total === 'number'
      ? ` ${st.kind === 'extracting' ? 'reading' : 'classifying'} ${st.current}/${st.total}`
      : ''

  const NavRow = ({ d }: { d: Dest }) => (
    <Link href={d.href} className={`ni${active === d.id ? ' on' : ''}`} onClick={closeSidebar}>
      <span className="ic"><NavIcon name={d.ic} /></span>{d.label}
    </Link>
  )

  return (
    <>
      <aside className="side">
        <div className="brand">
          <Link className="brand-home" href="/today" onClick={closeSidebar}>
            <span className="mk"><BrandMark /></span>earwise
          </Link>
        </div>

        <Link href="/today" className={`ni home${active === 'today' ? ' on' : ''}`} onClick={closeSidebar}>
          <span className="ic"><NavIcon name="today" /></span>Today
        </Link>

        <div className="tg">
          <Link className={`t${stage === 'demand' ? ' on' : ''}`} href="/demand" onClick={closeSidebar}>
            <span className="tn">1</span>
            <span className="tl"><b>Demand</b><span className="x">what they want</span></span>
            <span className="tar">→</span>
          </Link>
          <Link className={`t${stage === 'distribution' ? ' on' : ''}`} href="/warm-leads" onClick={closeSidebar}>
            <span className="tn">2</span>
            <span className="tl"><b>Distribution</b><span className="x">reach them</span></span>
            <span className="tar">→</span>
          </Link>
        </div>

        {dests && (
          <>
            <div className="mn">{stage === 'demand' ? 'Demand' : 'Distribution'}</div>
            {dests.map((d) => <NavRow key={d.id} d={d} />)}
          </>
        )}

        <div className="scan-row">
          <button
            type="button"
            className={`scan${scan.anyStreaming ? ' spinning' : ''}`}
            onClick={scan.anyStreaming ? scan.stopScan : scan.scanAll}
            disabled={!scan.anyStreaming && watchlist.length === 0}
          >
            <span className="scan-ic"><NavIcon name="scan" /></span>{scan.anyStreaming ? (postsFound > 0 ? `Scanning · ${postsFound}` : 'Scanning…') : 'Scan for new'}
          </button>
          <Link className={`scan-set${active === 'sources' ? ' on' : ''}`} href="/sources" title="Scan settings" aria-label="Scan settings" onClick={closeSidebar}>⚙</Link>
        </div>
        <div className="last">
          {scan.anyStreaming
            ? (activeSub ? `r/${activeSub}${stageStr}` : `${postsFound} posts · reading your sources…`)
            : `last scan ${lastScan}`}
        </div>
      </aside>

      {/* mobile chrome (under 720px) */}
      <header className="mobile-top">
        <div className="brand"><Link className="brand-home" href="/today"><span className="mk"><BrandMark /></span>earwise</Link></div>
        <Link className="mlabel" href="/sources">⚙ Scan settings</Link>
      </header>
      <nav className="mobile-nav">
        {MOBILE_TABS.map((tb) => {
          const on = tb.stage ? stage === tb.stage : active === tb.id
          return (
            <Link key={tb.id} className={`mt${on ? ' on' : ''}`} href={tb.href}>
              <span className="mic"><NavIcon name={tb.ic} /></span>{tb.label}
            </Link>
          )
        })}
        <Link className={`mt scan-tab${active === 'sources' ? ' on' : ''}`} href="/sources">
          <span className="mic"><NavIcon name="scan" /></span>Scan
        </Link>
      </nav>
    </>
  )
}

function formatLastScan(ts: number | null): string {
  if (!ts) return 'never'
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

// Brand mark — listen (incoming demand waves) → distribute (outward arrow).
function BrandMark() {
  return (
    <svg className="bm" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path d="M4.5 8.5 A4.2 4.2 0 0 1 4.5 15.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M9 6 A8 8 0 0 1 9 18" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity="0.42" />
      <path d="M12.5 6 L21 12 L12.5 18 Z" fill="currentColor" />
    </svg>
  )
}

type IconName = 'today' | 'opportunities' | 'buyervoice' | 'warmleads' | 'drafts' | 'scan'
function NavIcon({ name }: { name: IconName }) {
  const inner: Record<IconName, React.ReactNode> = {
    today: <><rect x="4" y="5" width="16" height="16" rx="2" /><path d="M4 9.5h16" /><path d="M8 3v4" /><path d="M16 3v4" /><path d="M9 14.5l2 2 4-4" /></>,
    opportunities: <><path d="M9.5 18.5h5" /><path d="M10.5 21h3" /><path d="M12 2.5a6 6 0 0 0-3.7 10.8c.6.5 1 1.1 1.1 2.2h5.2c.1-1.1.5-1.7 1.1-2.2A6 6 0 0 0 12 2.5z" /></>,
    buyervoice: <path d="M21 11.5a7.5 7.5 0 0 1-11 6.6L4 20l1.4-4.4A7.5 7.5 0 1 1 21 11.5z" />,
    warmleads: <path d="M13 2.5c.5 3 3 4.2 3.8 7.2A5 5 0 1 1 8 11c0-2 .8-3 .8-3 .2 1 .8 1.7 1.6 2 .2-2.7 1.4-5.4 2.6-7.5z" />,
    drafts: <><path d="M16.2 3.6a2.1 2.1 0 0 1 3 3L7.5 18.3 3.5 19.5l1.2-4z" /><path d="M14.3 5.5l3 3" /></>,
    scan: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="M20 20l-4.6-4.6" /></>,
  }
  return (
    <svg className="ni-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{inner[name]}</svg>
  )
}
