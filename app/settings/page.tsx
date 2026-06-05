'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Topbar } from '../_components/components'
import { useScanCtx } from '../_components/scan-provider'
import { VoiceSamples } from '../_components/voice-samples'
import { BusinessProfileForm } from '../_components/business-profile-form'
import { NicheField } from '../_components/niche-field'
import { Icons } from '../_components/icons'

// Settings — configure once, get out of the way. Business profile + voice
// samples (sources live in Discover). URL-persisted tabs like Pipeline/Voice.
type View = 'business' | 'voice'
const VIEWS: { id: View; label: string }[] = [
  { id: 'business', label: 'Business' },
  { id: 'voice', label: 'Voice samples' },
]

function SettingsInner() {
  const scan = useScanCtx()
  const params = useSearchParams()
  const view: View = params.get('view') === 'voice' ? 'voice' : 'business'

  return (
    <>
      <Topbar title="Settings" posts={scan.posts}>
        <nav className="seg" aria-label="Settings view">
          {VIEWS.map((v) => (
            <Link
              key={v.id}
              href={`/settings?view=${v.id}`}
              className={`seg-btn${view === v.id ? ' on' : ''}`}
              aria-current={view === v.id ? 'page' : undefined}
            >
              {v.label}
            </Link>
          ))}
        </nav>
      </Topbar>

      <div className="content scroll">
        {view === 'business' ? (
          <>
            <NicheField />
            <BusinessProfileForm />
          </>
        ) : (
          <VoiceSamples />
        )}

        <div className="card" style={{ padding: '12px 16px', marginTop: 'var(--gap)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink-3)' }}>
          <Icons.compass size={14} />
          <span>Manage which subreddits you watch in </span>
          <Link href="/explore" style={{ color: 'var(--accent-text)', textDecoration: 'underline' }}>Discover</Link>
          <span>.</span>
        </div>
      </div>
    </>
  )
}

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsInner />
    </Suspense>
  )
}
