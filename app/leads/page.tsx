import { redirect } from 'next/navigation'

// Leads moved into Pipeline (redesign · Zaslon 3). Keep the old path working.
export default function LeadsRedirect() {
  redirect('/pipeline')
}
