'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useScanCtx, useWatchlistCtx } from './scan-provider'
import { useSidebarCtx } from './sidebar-provider'
import { ThemeToggle } from './theme-toggle'
import { ProjectSwitcher } from './project-switcher'
import { Icons, Spinner, type SimpleIconProps } from './icons'

// Dark, vertical sidebar. The information architecture is the redesign's
// triage-first shell (REDESIGN-SPEC › Global shell): Today / Opportunities /
// Pipeline up top, everything else folded into a collapsible "Advanced" group.
// Every existing route stays reachable.
type NavLink = { href: string; label: string; icon: (p: SimpleIconProps) => React.ReactNode }
type NavGroup = { label?: string; items: NavLink[]; collapsible?: boolean }

// The reshaped skeleton: Home (what's happening) → Voice (what to say) →
// Act (say it) → Discover, with everything else folded into Advanced + Settings.
const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { href: '/today', label: 'Home', icon: Icons.inbox },
      { href: '/voice', label: 'Voice', icon: Icons.chat },
      { href: '/pipeline', label: 'Act', icon: Icons.flag },
      { href: '/explore', label: 'Discover', icon: Icons.compass },
    ],
  },
  {
    label: 'Advanced',
    collapsible: true,
    items: [
      { href: '/insights', label: 'Trends & Insights', icon: Icons.sparkles },
    ],
  },
]

const ADVANCED_KEY = 'earwise:advanced-open'

function isActive(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname.startsWith(href)
}

export function NavBar() {
  const pathname = usePathname()
  const { watchlist } = useWatchlistCtx()
  const scan = useScanCtx()
  const { open: sidebarOpen, closeSidebar } = useSidebarCtx()
  // Advanced is collapsed by default; an explicit toggle persists, otherwise it
  // auto-reveals once the first scan has completed (progressive disclosure).
  const [advancedOpen, setAdvancedOpen] = useState(false)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(ADVANCED_KEY)
      if (saved === 'true' || saved === 'false') setAdvancedOpen(saved === 'true')
    } catch {
      /* storage unavailable */
    }
  }, [])
  const scanned = scan.posts.length > 0 || scan.lastScanAt != null
  useEffect(() => {
    try {
      if (scanned && localStorage.getItem(ADVANCED_KEY) === null) setAdvancedOpen(true)
    } catch {
      /* storage unavailable */
    }
  }, [scanned])
  function toggleAdvanced() {
    setAdvancedOpen((o) => {
      const next = !o
      try { localStorage.setItem(ADVANCED_KEY, String(next)) } catch { /* ignore */ }
      return next
    })
  }

  const lastScanLabel = formatLastScan(scan.lastScanAt)

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
            {/* Shift the burst to sit centered in the tile — matches app/icon.svg. */}
            <g transform="translate(-16 6)">
              <circle cx="96" cy="170" r="15" fill="#0E0F13" />
              <path d="M135,170 A39,39 0 0 0 96,131" fill="none" stroke="#0E0F13" strokeWidth="18" strokeLinecap="round" />
              <path d="M167,170 A71,71 0 0 0 96,99" fill="none" stroke="#0E0F13" strokeWidth="18" strokeLinecap="round" />
              <path d="M199,170 A103,103 0 0 0 96,67" fill="none" stroke="#0E0F13" strokeWidth="18" strokeLinecap="round" />
            </g>
          </svg>
        </div>
        <div className="brand-name">
          <b>earwise</b>
        </div>
      </Link>

      <ProjectSwitcher />

      <button
        type="button"
        className="cmdk-trigger"
        onClick={() => window.dispatchEvent(new Event('earwise:open-cmdk'))}
      >
        <Icons.scan size={13} />
        <span>Search & run</span>
        <kbd className="cmdk-kbd">⌘K</kbd>
      </button>

      {NAV_GROUPS.map((group, gi) => {
        const collapsed = group.collapsible ? !advancedOpen : false
        return (
          <div key={group.label ?? gi}>
            {group.label &&
              (group.collapsible ? (
                <button
                  type="button"
                  className="side-label side-label-btn"
                  onClick={toggleAdvanced}
                  aria-expanded={advancedOpen}
                >
                  {group.label}
                  <Icons.chev size={12} className={`side-label-chev${advancedOpen ? ' open' : ''}`} />
                </button>
              ) : (
                <div className="side-label">{group.label}</div>
              ))}
            {!collapsed &&
              group.items.map((item) => {
                const Icon = item.icon
                const active = isActive(pathname, item.href)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`nav-item${active ? ' active' : ''}`}
                    aria-current={active ? 'page' : undefined}
                  >
                    <Icon />
                    {item.label}
                  </Link>
                )
              })}
          </div>
        )
      })}

      <div className="side-sep" />
      <Link
        href="/settings"
        className={`nav-item${isActive(pathname, '/settings') ? ' active' : ''}`}
        aria-current={isActive(pathname, '/settings') ? 'page' : undefined}
      >
        <Icons.wrench />
        Settings
      </Link>

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
