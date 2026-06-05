'use client'

import { Suspense } from 'react'
import { WarmLeads } from '../_components/warm-leads'

export default function WarmLeadsPage() {
  return (
    <Suspense fallback={null}>
      <WarmLeads />
    </Suspense>
  )
}
