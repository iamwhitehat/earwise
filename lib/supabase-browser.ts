import { createBrowserClient } from '@supabase/ssr'

// Browser Supabase client for AUTH only (sign-in / sign-out / session). The
// shared data cache is still written through the service-role client in
// lib/supabase.ts. Uses the public anon key — safe to ship to the browser.
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
