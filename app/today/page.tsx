'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Topbar } from '../_components/components'
import { useScanCtx } from '../_components/scan-provider'
import { TodayView } from '../_components/today-view'
import { OpportunitiesView } from '../_components/opportunities-view'
import { SignalsView } from '../_components/signals-view'

// Home — the consolidated "what's happening / what to act on" surface. Today,
// the ranked Opportunities list, and the Signal feed are URL-persisted tabs
// (?view=), mirroring Pipeline/Voice. /signals and /opportunities redirect in.
type View = 'today' | 'opportunities' | 'signals'
const VIEWS: { id: View; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'opportunities', label: 'Opportunities' },
  { id: 'signals', label: 'Signals' },
]

function HomeInner() {
  const scan = useScanCtx()
  const params = useSearchParams()
  const raw = params.get('view')
  const view: View = raw === 'opportunities' || raw === 'signals' ? raw : 'today'

  return (
    <>
      <Topbar title="Home" posts={scan.posts} hideStats>
        <nav className="seg" aria-label="Home view">
          {VIEWS.map((v) => (
            <Link
              key={v.id}
              href={`/today?view=${v.id}`}
              className={`seg-btn${view === v.id ? ' on' : ''}`}
              aria-current={view === v.id ? 'page' : undefined}
            >
              {v.label}
            </Link>
          ))}
        </nav>
      </Topbar>

      <div className="content scroll">
        {view === 'today' && <TodayView />}
        {view === 'opportunities' && <OpportunitiesView />}
        {view === 'signals' && <SignalsView />}
      </div>
    </>
  )
}

export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <HomeInner />
    </Suspense>
  )
}
