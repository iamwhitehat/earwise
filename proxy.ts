// Next 16 "proxy" (the renamed middleware). Refreshes the Supabase auth session
// on every request and gates the app behind Google sign-in: unauthenticated
// requests are redirected to /login, except the public surfaces (login itself,
// the OAuth callback, and the marketing/demo site). API routes are not matched
// here — they keep their own access model + the service-role cache.
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const PUBLIC_PREFIXES = ['/login', '/auth', '/site']

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

  const path = request.nextUrl.pathname
  const isPublic = PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))
  if (!user && !isPublic) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    return NextResponse.redirect(loginUrl)
  }

  return response
}

export const config = {
  matcher: [
    // Run on every page route except Next internals, static assets, icons, and
    // /api (the public demo route /api/projects/demo + the service-role data
    // APIs live under /api and keep their own access model).
    '/((?!api|_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
