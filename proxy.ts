// Next 16 "proxy" (the renamed middleware). Refreshes the Supabase auth session
// on every request and gates the app behind Google sign-in. Unauthenticated:
//   - page routes  → redirected to /login (except the public surfaces below)
//   - /api routes  → 401 JSON (except the free, public demo seeder)
// The cost-bearing API routes (Claude calls, scans) have no auth of their own,
// so without this gate anyone with the URL could spend your API budget.
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Public page surfaces: sign-in, the OAuth callback, the marketing/demo site.
const PUBLIC_PAGE_PREFIXES = ['/login', '/auth', '/site']
// /api routes that bypass the SESSION gate — each enforces its own access:
//   /api/projects/demo → public demo seeder (free, makes no model calls)
//   /api/cron/run      → scheduled job, auth'd by CRON_SECRET. Vercel Cron has
//                        no Supabase session, so the session gate can't apply;
//                        the route's own secret check is its access control.
const UNGATED_API_PREFIXES = ['/api/projects/demo', '/api/cron/run']

function matchesPrefix(path: string, prefixes: string[]): boolean {
  return prefixes.some((p) => path === p || path.startsWith(`${p}/`))
}

export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  // Auth not configured yet → don't gate, so the app stays usable before setup.
  if (!url || !anon) return NextResponse.next()

  let response = NextResponse.next({ request })
  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
      },
    },
  })

  // IMPORTANT: getUser() (not getSession) so the session is verified + refreshed.
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    const path = request.nextUrl.pathname
    if (path.startsWith('/api/')) {
      // A redirect would be wrong for fetch() — return a real 401 instead.
      if (!matchesPrefix(path, UNGATED_API_PREFIXES)) {
        return NextResponse.json({ error: 'Authentication required.' }, { status: 401 })
      }
    } else if (!matchesPrefix(path, PUBLIC_PAGE_PREFIXES)) {
      const loginUrl = request.nextUrl.clone()
      loginUrl.pathname = '/login'
      return NextResponse.redirect(loginUrl)
    }
  }

  return response
}

export const config = {
  matcher: [
    // Run on every page + API route except Next internals, static assets, and
    // icons/images. /api is now included so the data + Claude APIs are gated
    // (the public /api/projects/demo route is allow-listed inside proxy()).
    '/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
