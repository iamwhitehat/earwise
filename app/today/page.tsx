'use client'

import { DailyBrief } from '../_components/daily-brief'

// Home = the Daily Brief, full stop (spec §6.2). No topbar, no tabs — the design's
// sidebar is the only navigation. (Opportunities → /demand, Signals → /warm-leads.)
export default function HomePage() {
  return <DailyBrief />
}
