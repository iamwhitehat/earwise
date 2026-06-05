'use client'

import { Suspense } from 'react'
import { Demand } from '../_components/demand'

export default function DemandPage() {
  return (
    <Suspense fallback={null}>
      <Demand />
    </Suspense>
  )
}
