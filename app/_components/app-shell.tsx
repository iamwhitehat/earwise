'use client'

import { usePathname } from 'next/navigation'
import { NavBar } from './nav-bar'
import { ScanProvider } from './scan-provider'
import { SidebarBackdrop, SidebarProvider } from './sidebar-provider'
import { CommandPalette } from './command-palette'

// Standalone, full-bleed routes (the public marketing site) render without the
// app sidebar/providers. Everything else gets the normal product chrome.
const STANDALONE_PREFIXES = ['/site']

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const standalone = STANDALONE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))

  if (standalone) return <>{children}</>

  return (
    <ScanProvider>
      <SidebarProvider>
        <div className="app">
          <NavBar />
          <SidebarBackdrop />
          <main className="main scroll">{children}</main>
        </div>
        <CommandPalette />
      </SidebarProvider>
    </ScanProvider>
  )
}
