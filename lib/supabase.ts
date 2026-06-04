// Importing this module from a client component triggers a build-time error.
// The service-role key below must never reach the browser.
import 'server-only'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let _client: SupabaseClient | null = null

function isPlaceholder(value: string): boolean {
  return value.includes('REPLACE_WITH_YOUR')
}

export function getSupabase(): SupabaseClient {
  if (_client) return _client

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key || isPlaceholder(url) || isPlaceholder(key)) {
    throw new Error(
      'Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local. See SETUP.md for step-by-step instructions.'
    )
  }

  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return _client
}
