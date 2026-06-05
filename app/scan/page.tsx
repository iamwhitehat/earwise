'use client'

import Link from 'next/link'
import { ScanDemo } from '../_components/scan-demo'
import '../site/earwise-site.css'

// Public, no-signup instant scan — the standalone top-of-funnel (also embedded in
// the /site hero). Renders the shared <ScanDemo /> in the marketing-site theme.
export default function ScanPage() {
  return (
    <div className="ew-site" style={{ minHeight: '100vh', background: 'var(--base)' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '30px 20px 80px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 40 }}>
          <Link href="/site" style={{ fontWeight: 700, fontSize: 17, color: 'var(--text)', textDecoration: 'none', letterSpacing: '-0.01em' }}>
            earwise
          </Link>
          <Link href="/login" className="btn btn-ghost btn-sm">Sign in</Link>
        </div>

        <h1 style={{ fontSize: 'clamp(26px, 5vw, 38px)', fontWeight: 650, letterSpacing: '-0.02em', color: 'var(--text)', lineHeight: 1.15, margin: '0 0 12px' }}>
          See who&apos;s asking to buy what you sell — <span className="sig">right now.</span>
        </h1>
        <p style={{ fontSize: 16, lineHeight: 1.55, color: 'var(--muted)', margin: '0 0 26px', maxWidth: 560 }}>
          Type your niche. earwise scans Reddit, Hacker News &amp; StackOverflow for people actively
          looking to buy, and drafts a reply in your voice — free, no signup.
        </p>

        <ScanDemo autoFocus />
      </div>
    </div>
  )
}
