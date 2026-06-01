'use client'

import Link from 'next/link'
import { Icons } from '@/app/_components/icons'

export default function Error({ error }: { error: Error }) {
  return (
    <div className="content scroll">
      <div className="card empty fade-in" style={{ maxWidth: 520, margin: '40px auto' }}>
        <span className="e-ico">
          <Icons.alert size={28} />
        </span>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)', margin: '0 0 6px' }}>
          {error.message || 'Something went wrong'}
        </h2>
        <p style={{ fontSize: 13, color: 'var(--ink-3)', margin: '0 0 18px' }}>
          The subreddit may be private, banned, or misspelled.
        </p>
        <Link href="/explore" className="btn btn-primary">
          <Icons.compass size={14} /> Back to Explore
        </Link>
      </div>
    </div>
  )
}
