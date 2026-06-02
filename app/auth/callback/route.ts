import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getSupabase } from '@/lib/supabase'
import { listProjects } from '@/lib/projects-db'
import { DEFAULT_PROJECT_ID } from '@/lib/projects'

// OAuth callback: exchange the code for a session, then route a first-time user
// (no project yet) into onboarding, and returning users home.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  if (!code) return NextResponse.redirect(`${origin}/login?error=missing_code`)

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) return NextResponse.redirect(`${origin}/login?error=auth`)

  // No real (non-default) project yet → onboarding; otherwise home.
  let dest = '/welcome'
  try {
    const projects = await listProjects(getSupabase())
    if (projects.some((p) => p.id !== DEFAULT_PROJECT_ID)) dest = '/'
  } catch {
    // projects unavailable (unconfigured / unmigrated) → onboarding
  }
  return NextResponse.redirect(`${origin}${dest}`)
}
