'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Icons } from './icons'

// Right-drawer pattern (REDESIGN-SPEC › Global shell): detail opens in a
// slide-in panel from the right; the list/context behind it never moves. Stack
// is drill-down — pushing a new entry keeps the previous, `←` pops back, `Esc`
// or `⌘.` pops the top, the close button or scrim dismisses all.
type Entry = { id: number; title: string; node: ReactNode }

type DrawerCtx = {
  push: (node: ReactNode, title?: string) => void
  pop: () => void
  closeAll: () => void
  depth: number
}

const Ctx = createContext<DrawerCtx | null>(null)

export function DrawerProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<Entry[]>([])
  const idRef = useRef(0)

  const push = useCallback((node: ReactNode, title = 'Details') => {
    idRef.current += 1
    setStack((s) => [...s, { id: idRef.current, title, node }])
  }, [])
  const pop = useCallback(() => setStack((s) => s.slice(0, -1)), [])
  const closeAll = useCallback(() => setStack([]), [])

  useEffect(() => {
    if (stack.length === 0) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && e.key === '.')) {
        e.preventDefault()
        pop()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stack.length, pop])

  const top = stack[stack.length - 1]

  return (
    <Ctx.Provider value={{ push, pop, closeAll, depth: stack.length }}>
      {children}
      {top && (
        <div className="drawer-scrim" onClick={pop}>
          <aside
            className="drawer"
            role="dialog"
            aria-label={top.title}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="drawer-head">
              {stack.length > 1 && (
                <button type="button" className="drawer-back" onClick={pop} aria-label="Back">
                  <Icons.chev size={15} className="drawer-back-chev" />
                </button>
              )}
              <span className="drawer-title">{top.title}</span>
              <button type="button" className="drawer-close" onClick={closeAll} aria-label="Close">
                <Icons.x size={16} />
              </button>
            </header>
            <div className="drawer-body scroll">{top.node}</div>
          </aside>
        </div>
      )}
    </Ctx.Provider>
  )
}

export function useDrawer(): DrawerCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useDrawer must be used inside <DrawerProvider>')
  return ctx
}
