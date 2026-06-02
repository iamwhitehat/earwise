'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Topbar } from '../_components/components'
import { useScanCtx } from '../_components/scan-provider'
import { LeadsBoard } from '../_components/leads-board'
import { PlanView } from '../_components/plan-view'
import { ReachView } from '../_components/reach-view'

// Pipeline (REDESIGN-SPEC › Zaslon 3): the act space, segmented into
// Leads | Plan | Reach. The active view is URL-persisted (?view=) so it's
// shareable + resumable. Old routes redirect in: /leads → here,
// /guide → ?view=plan.
type View = 'leads' | 'plan' | 'reach'
const VIEWS: { id: View; label: string }[] = [
  { id: 'leads', label: 'Leads' },
  { id: 'plan', label: 'Plan' },
  { id: 'reach', label: 'Reach' },
]

function PipelineInner() {
  const scan = useScanCtx()
  const params = useSearchParams()
  const raw = params.get('view')
  const view: View = raw === 'plan' || raw === 'reach' ? raw : 'leads'

  return (
    <>
      <Topbar title="Pipeline" posts={scan.posts}>
        <nav className="seg" aria-label="Pipeline view">
          {VIEWS.map((v) => (
            <Link
              key={v.id}
              href={`/pipeline?view=${v.id}`}
              className={`seg-btn${view === v.id ? ' on' : ''}`}
              aria-current={view === v.id ? 'page' : undefined}
            >
              {v.label}
            </Link>
          ))}
        </nav>
      </Topbar>

      <div className="content scroll">
        {view === 'leads' && <LeadsBoard />}
        {view === 'plan' && <PlanView />}
        {view === 'reach' && <ReachView />}
      </div>
    </>
  )
}

export default function PipelinePage() {
  return (
    <Suspense fallback={null}>
      <PipelineInner />
    </Suspense>
  )
}
