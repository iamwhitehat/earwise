'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { CATEGORY_CONFIG, CATEGORY_ORDER, type Category } from '@/lib/categories'
import { fetchSubPosts, type ApiPost } from '@/lib/posts-client'
import { BulkDeepScanBar, PostCard } from '@/app/_components/components'
import type { TaggedPost } from '@/lib/scan-types'

function Skeleton() {
  return (
    <div className="content scroll">
      <div className="card" style={{ padding: 'var(--pad)' }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} style={{ padding: '12px 0' }}>
            <div className="skel" style={{ height: 14, width: '70%', marginBottom: 8 }} />
            <div className="skel" style={{ height: 12, width: '40%' }} />
          </div>
        ))}
      </div>
    </div>
  )
}

function ErrorState({ subreddit, message }: { subreddit: string; message: string }) {
  return (
    <div className="content scroll">
      <div className="card empty">
        <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)', margin: '0 0 6px' }}>
          {message}
        </h2>
        <p style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 18 }}>
          r/{subreddit} may be private, banned, or misspelled — or the server isn&apos;t
          configured yet.
        </p>
        <Link href="/explore" className="btn btn-primary">
          Back to Explore
        </Link>
      </div>
    </div>
  )
}

export default function PostList({ subreddit }: { subreddit: string }) {
  const [posts, setPosts] = useState<TaggedPost[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)

    fetchSubPosts(subreddit)
      .then(({ posts }) => {
        // Promote ApiPost → TaggedPost by tagging with sub + index. Insight
        // fields (tools/quotes/etc.) already arrive populated from the server.
        const tagged: TaggedPost[] = (posts as ApiPost[]).map((p, i) => ({
          ...p,
          subreddit,
          index: i,
        }))
        setPosts(tagged)
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }, [subreddit])

  if (loading) return <Skeleton />
  if (error) return <ErrorState subreddit={subreddit} message={error} />

  const grouped: Record<Category, TaggedPost[]> = {
    pain_point: [],
    feature_request: [],
    tool_complaint: [],
    other: [],
  }
  for (const post of posts) grouped[post.category].push(post)
  const visibleCategories = CATEGORY_ORDER.filter((c) => grouped[c].length > 0)

  return (
    <div className="content scroll">
      <div className="sub-hero fade-in" style={{ marginBottom: 'var(--gap)' }}>
        <div className="sub-hero-mark">r/</div>
        <div>
          <h1>r/{subreddit}</h1>
          <div className="sub-hero-meta tnum">
            {posts.length} classified post{posts.length === 1 ? '' : 's'}
          </div>
        </div>
        <div className="sub-hero-stats">
          {CATEGORY_ORDER.map((cat) => {
            const count = grouped[cat].length
            if (count === 0) return null
            const cfg = CATEGORY_CONFIG[cat]
            return (
              <span key={cat} className={`badge badge-${cfg.cls}`}>
                <span className="bdot" />
                {count} {cfg.short}
                {count === 1 ? '' : 's'}
              </span>
            )
          })}
        </div>
      </div>

      <BulkDeepScanBar sub={subreddit} />

      {visibleCategories.map((cat) => {
        const cfg = CATEGORY_CONFIG[cat]
        const items = grouped[cat]
        return (
          <section className="catgroup" key={cat}>
            <div className="catgroup-head">
              <span className="lbl" style={{ color: `var(--${cfg.cls})` }}>
                {cfg.label}
              </span>
              <span className="n">{items.length}</span>
            </div>
            <div className="card">
              {items.map((post) => (
                <PostCard key={post.id} post={post} showCategoryBadge={false} />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
