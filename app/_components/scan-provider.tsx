'use client'

import { createContext, useContext, type ReactNode } from 'react'
import { useWatchlist, type Watchlist } from '@/lib/use-watchlist'
import { useScan, type ScanHook } from '@/lib/use-scan'
import { usePostsPerScan, type PostsPerScan } from '@/lib/use-posts-per-scan'

// One context for the whole app: scan state + watchlist + posts-per-scan
// preference live above the route boundary so they persist across Dashboard
// ↔ Explore navigation. Without this, each route would mount its own
// useScan and a scan started on one page would be orphaned when the user
// navigates away — its streaming fetches stay open, hit the browser's
// connection limit, and the next page's requests queue behind them (which
// looks like "navigation is blocked").
type PostsPerScanCtx = {
  postsPerScan: PostsPerScan
  setPostsPerScan: (n: PostsPerScan) => void
}

type Ctx = {
  watchlist: Watchlist
  scan: ScanHook
  postsPerScan: PostsPerScanCtx
}

const ScanContext = createContext<Ctx | null>(null)

export function ScanProvider({ children }: { children: ReactNode }) {
  const watchlist = useWatchlist()
  const pps = usePostsPerScan()
  const scan = useScan(watchlist.watchlist, watchlist.hydrated, pps.postsPerScan)
  return (
    <ScanContext.Provider
      value={{
        watchlist,
        scan,
        postsPerScan: { postsPerScan: pps.postsPerScan, setPostsPerScan: pps.setPostsPerScan },
      }}
    >
      {children}
    </ScanContext.Provider>
  )
}

export function useWatchlistCtx(): Watchlist {
  const ctx = useContext(ScanContext)
  if (!ctx) throw new Error('useWatchlistCtx must be used inside <ScanProvider>')
  return ctx.watchlist
}

export function useScanCtx(): ScanHook {
  const ctx = useContext(ScanContext)
  if (!ctx) throw new Error('useScanCtx must be used inside <ScanProvider>')
  return ctx.scan
}

export function usePostsPerScanCtx(): PostsPerScanCtx {
  const ctx = useContext(ScanContext)
  if (!ctx) throw new Error('usePostsPerScanCtx must be used inside <ScanProvider>')
  return ctx.postsPerScan
}
