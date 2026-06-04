import { redirect } from 'next/navigation'

// The Opportunities list folded into Home (IA reshape). The body now lives in
// app/_components/opportunities-view.tsx, rendered by /today?view=opportunities.
// The per-topic workspace at /opportunities/[topic] is unchanged.
export default function OpportunitiesRedirect() {
  redirect('/today?view=opportunities')
}
