import { redirect } from 'next/navigation'

// The dashboard was retired; Today is the one home. Keep the path resolving.
export default function DashboardRedirect() {
  redirect('/')
}
