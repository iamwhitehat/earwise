'use client'

import { useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'

// Pre-auth screen (dark + lime, full-bleed via AppShell). Google-only sign-in;
// a quiet "See a demo" link into the public marketing/demo site.
export default function LoginPage() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function signIn() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const supabase = createSupabaseBrowserClient()
      const { error: err } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${location.origin}/auth/callback` },
      })
      if (err) throw err
      // On success the browser is redirected to Google; nothing else to do.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in is not configured.')
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <div className="login-card">
        <div className="login-brand">
          <span className="login-mark" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 256 256">
              <circle cx="96" cy="170" r="15" fill="#0E0F13" />
              <path d="M135,170 A39,39 0 0 0 96,131" fill="none" stroke="#0E0F13" strokeWidth="18" strokeLinecap="round" />
              <path d="M167,170 A71,71 0 0 0 96,99" fill="none" stroke="#0E0F13" strokeWidth="18" strokeLinecap="round" />
              <path d="M199,170 A103,103 0 0 0 96,67" fill="none" stroke="#0E0F13" strokeWidth="18" strokeLinecap="round" />
            </svg>
          </span>
          <span className="login-word">earwise</span>
        </div>
        <h1 className="login-h">Catch the signal first.</h1>
        <p className="login-sub">Demand intelligence for founders — sign in to your workspace.</p>

        <button type="button" className="login-google" onClick={signIn} disabled={busy}>
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
            <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
            <path fill="#FBBC05" d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
            <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
          </svg>
          {busy ? 'Redirecting…' : 'Continue with Google'}
        </button>

        {error && <p className="login-err">{error}</p>}

        <a href="/site" className="login-demo">See a demo →</a>
      </div>
    </div>
  )
}
