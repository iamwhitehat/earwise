// Server-side Supabase AUTH client (reads/writes the session cookies). Used by
// the OAuth callback + any server code that needs the signed-in user. Data
// writes to the shared cache still go through the service-role client
// (lib/supabase.ts). server-only.
import 'server-only'

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createSupabaseServerClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options)
            }
          } catch {
            // setAll from a Server Component is a no-op (cookies are read-only
            // there) — the proxy refreshes the session, so this is safe to ignore.
          }
        },
      },
    },
  )
}
