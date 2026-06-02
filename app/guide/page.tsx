import { redirect } from 'next/navigation'

// The strategist moved into Pipeline › Plan (redesign · Zaslon 3).
export default function GuideRedirect() {
  redirect('/pipeline?view=plan')
}
