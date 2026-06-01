'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { usePathname } from 'next/navigation'

type SidebarCtxValue = {
  open: boolean
  openSidebar: () => void
  closeSidebar: () => void
}

const SidebarCtx = createContext<SidebarCtxValue | null>(null)

/**
 * Tracks the mobile sidebar drawer state. On desktop the sidebar is always
 * visible (CSS-controlled), so `open` only meaningfully changes layout below
 * the responsive breakpoint. Closes automatically on route change and on
 * Escape, both of which are common drawer dismissal expectations.
 */
export function SidebarProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  const openSidebar = useCallback(() => setOpen(true), [])
  const closeSidebar = useCallback(() => setOpen(false), [])

  // Escape dismisses the drawer. Listener only attached while open so we
  // don't burn cycles or interfere with other Escape handlers when closed.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // Auto-close when the user navigates — clicking a nav item shouldn't leave
  // the drawer hanging on top of the content they navigated to.
  useEffect(() => {
    setOpen(false)
  }, [pathname])

  return (
    <SidebarCtx.Provider value={{ open, openSidebar, closeSidebar }}>
      {children}
    </SidebarCtx.Provider>
  )
}

export function useSidebarCtx(): SidebarCtxValue {
  const ctx = useContext(SidebarCtx)
  if (!ctx) throw new Error('useSidebarCtx must be used inside <SidebarProvider>')
  return ctx
}

export function SidebarBackdrop() {
  const { open, closeSidebar } = useSidebarCtx()
  if (!open) return null
  return (
    <div
      className="side-backdrop"
      onClick={closeSidebar}
      aria-hidden="true"
    />
  )
}
