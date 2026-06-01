'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useScanCtx, useWatchlistCtx } from './scan-provider'
import { useSidebarCtx } from './sidebar-provider'
import { ThemeToggle } from './theme-toggle'
import { ProjectSwitcher } from './project-switcher'
import { Icons, Spinner, type SimpleIconProps } from './icons'

// Dark, vertical sidebar. The information architecture mirrors the funnel a
// founder actually walks — Discover → Opportunities → Customer Voice → Act —
// rather than a flat list of features. Folded-in destinations (Insights under
// Opportunities, the raw Signal feed under Act) render as nested sub-items.
type NavLink = { href: string; label: string; icon: (p: SimpleIconProps) => React.ReactNode; sub?: boolean }
type NavGroup = { label: string; items: NavLink[] }

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Discover',
    items: [{ href: '/explore', label: 'Discover', icon: Icons.compass }],
  },
  {
    label: 'Opportunities',
    items: [
      { href: '/', label: 'Opportunities', icon: Icons.grid },
      { href: '/insights', label: 'Trends & Insights', icon: Icons.sparkles, sub: true },
    ],
  },
  {
    label: 'Customer Voice',
    items: [{ href: '/customer-voice', label: 'Customer Voice', icon: Icons.chat }],
  },
  {
    label: 'Act',
    items: [
      { href: '/leads', label: 'Leads', icon: Icons.inbox },
      { href: '/signals', label: 'Signal feed', icon: Icons.bolt, sub: true },
    ],
  },
  {
    label: 'More',
    items: [
      { href: '/digest', label: 'Digest', icon: Icons.bell },
      { href: '/guide', label: 'Guide', icon: Icons.flag },
    ],
  },
]

function isActive(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname.startsWith(href)
}

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
      {/* earwise brand block — signal-burst mark (near-black on lime tile) + wordmark */}
      <Link href="/" className="brand" style={{ textDecoration: 'none' }}>
        <div className="brand-mark" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 256 256">
            <circle cx="96" cy="170" r="15" fill="#0E0F13" />
            <path d="M135,170 A39,39 0 0 0 96,131" fill="none" stroke="#0E0F13" strokeWidth="18" strokeLinecap="round" />
            <path d="M167,170 A71,71 0 0 0 96,99" fill="none" stroke="#0E0F13" strokeWidth="18" strokeLinecap="round" />
            <path d="M199,170 A103,103 0 0 0 96,67" fill="none" stroke="#0E0F13" strokeWidth="18" strokeLinecap="round" />
          </svg>
        </div>
        <div className="brand-name">
          <b>earwise</b>
        </div>
      </Link>

      <ProjectSwitcher />

      {NAV_GROUPS.map((group) => (
        <div key={group.label}>
          <div className="side-label">{group.label}</div>
          {group.items.map((item) => {
            const Icon = item.icon
            const active = isActive(pathname, item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-item${item.sub ? ' nav-sub' : ''}${active ? ' active' : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                <Icon />
                {item.label}
              </Link>
            )
          })}
        </div>
      ))}

      <div className="side-label">Watchlist · {watchlist.length}</div>
      <div className="side-watch">
        {watchlist.map((sub) => {
          const isSubActive = activeSub === sub.toLowerCase()
          return (
            <Link
              key={sub}
              href={`/r/${sub}`}
              className={`watch-row${isSubActive ? ' active' : ''}`}
              aria-current={isSubActive ? 'page' : undefined}
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
