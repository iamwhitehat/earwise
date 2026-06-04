import { redirect } from 'next/navigation'

// Signal feed folded into Home (IA reshape). The body now lives in
// app/_components/signals-view.tsx, rendered by /today?view=signals.
export default function SignalsRedirect() {
  redirect('/today?view=signals')
}
