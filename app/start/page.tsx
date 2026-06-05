'use client'

import { ScanProvider } from '../_components/scan-provider'
import { Onboarding } from '../_components/onboarding'

// Standalone full-screen onboarding (no app sidebar). Wrapped in ScanProvider so
// the watchlist + scan engine are available to the funnel.
export default function StartPage() {
  return (
    <ScanProvider>
      <Onboarding />
    </ScanProvider>
  )
}
