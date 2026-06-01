'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useScanCtx, useWatchlistCtx } from './scan-provider'
import { useSidebarCtx } from './sidebar-provider'
import { ThemeToggle } from './theme-toggle'
import { Icons, Spinner } from './icons'

// Dark, vertical sidebar (replaces the old horizontal NavBar). Contains
// brand + Dashboard / Explore links + watchlist with per-sub counts +
// a Scan button at the bottom. Watchlist items link to the legacy
// /r/[sub] view since the design's Subreddit Detail View isn't wired up.
export function NavBar() {
  const pathname = usePathname()
  const { watchlist } = useWatchlistCtx()
  const scan = useScanCtx()
  const { open: sidebarOpen, closeSidebar } = useSidebarCtx()

  const counts: Record<string, number> = {}
  for (const sub of watchlist) {
    counts[sub] = scan.buckets[sub]?.posts.length ?? 0
  }

  const lastScanLabel = formatLastScan(scan.lastScanAt)
  const onDash = pathname === '/'
  const onExplore = pathname.startsWith('/explore')
  const onInsights = pathname.startsWith('/insights')
  const onLanguage = pathname.startsWith('/language')
  const onSignals = pathname.startsWith('/signals')
  const onLeads = pathname.startsWith('/leads')

  // Identify the active watchlist sub from /r/[sub]. Case-folded compare
  // because seeded subs preserve their original case (`SaaS`) while
  // user-added subs are normalized to lowercase by useWatchlist.addSubreddit.
  const activeSubMatch = pathname.match(/^\/r\/([^/]+)/)
  const activeSub = activeSubMatch
    ? decodeURIComponent(activeSubMatch[1]).toLowerCase()
    : null

  return (
    <aside
      className={`side scroll${sidebarOpen ? ' open' : ''}`}
      aria-label="Primary navigation"
    >
      <button
        type="button"
        className="side-close"
        onClick={closeSidebar}
        aria-label="Close menu"
      >
        <Icons.x size={16} />
      </button>
      <Link href="/" className="brand" style={{ textDecoration: 'none' }}>
        <div className="brand-mark" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
            <circle cx="12" cy="12" r="9" opacity="0.55" />
            <circle cx="12" cy="12" r="5" />
            <circle cx="12" cy="12" r="1.6" fill="#fff" stroke="none" />
          </svg>
        </div>
        <div className="brand-name">
          <b>Reddit</b>
          <span>Radar</span>
        </div>
      </Link>

      <Link href="/" className={`nav-item${onDash ? ' active' : ''}`}>
        <Icons.grid />
        Dashboard
      </Link>
      <Link href="/explore" className={`nav-item${onExplore ? ' active' : ''}`}>
        <Icons.compass />
        Explore
      </Link>
      <Link href="/insights" className={`nav-item${onInsights ? ' active' : ''}`}>
        <Icons.sparkles />
        Insights
      </Link>
      <Link href="/language" className={`nav-item${onLanguage ? ' active' : ''}`}>
        <Icons.chat />
        Buyer Language
      </Link>
      <Link href="/signals" className={`nav-item${onSignals ? ' active' : ''}`}>
        <Icons.bolt />
        Signals
      </Link>
      <Link href="/leads" className={`nav-item${onLeads ? ' active' : ''}`}>
        <Icons.inbox />
        Leads
      </Link>

      <div className="side-label">Watchlist · {watchlist.length}</div>
      <div className="side-watch">
        {watchlist.map((sub) => {
          const isActive = activeSub === sub.toLowerCase()
          return (
            <Link
              key={sub}
              href={`/r/${sub}`}
              className={`watch-row${isActive ? ' active' : ''}`}
              aria-current={isActive ? 'page' : undefined}
            >
              <span className="watch-dot" />
              <span className="mono">r/{sub}</span>
              <span className="n">{counts[sub]}</span>
            </Link>
          )
        })}
        {watchlist.length === 0 && (
          <div style={{ padding: '6px 9px', fontSize: 12, color: 'var(--side-ink-3)' }}>
            No subs yet.{' '}
            <Link href="/explore" style={{ color: 'var(--accent-ring)' }}>
              Add some →
            </Link>
          </div>
        )}
      </div>

      <div className="side-foot">
        {scan.anyStreaming ? (
          <button type="button" className="scan-mini" onClick={scan.stopScan}>
            <Icons.stop size={15} /> Stop Scan
          </button>
        ) : (
          <button
            type="button"
            className="scan-mini"
            onClick={scan.scanAll}
            disabled={watchlist.length === 0}
          >
            <Icons.scan size={15} /> Scan for new
          </button>
        )}
        <div className="side-laststamp">
          {scan.anyStreaming ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Spinner size={11} /> Scanning…
            </span>
          ) : (
            <>Last scan {lastScanLabel}</>
          )}
        </div>
        <ThemeToggle />
      </div>
    </aside>
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
