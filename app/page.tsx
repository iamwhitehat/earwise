import { redirect } from 'next/navigation'

// Today is the single home (redesign · Zaslon 1). The old aggregate dashboard
// was retired — its pieces live on Today (hot-now + opportunities), Explore
// (post browsing + trends), Customer Voice, and Insights; "Ask your market"
// moved into the ⌘K palette (Ask mode).
export default function Home() {
  redirect('/today')
}
