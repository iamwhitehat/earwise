'use client'

import { Suspense, useCallback, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  AllTimePostsView,
  BulkDeepScanBar,
  CategoryGroups,
  ErrorsBanner,
  ScanBanner,
  ScannedSubreddits,
  SubSuggester,
  Topbar,
  TrendDetailPanel,
  TrendsPanel,
  WatchlistEditor,
  useDropStaleScanTopic,
} from '../_components/components'
import {
  usePostsPerScanCtx,
  useScanCtx,
  useWatchlistCtx,
} from '../_components/scan-provider'
import { POSTS_PER_SCAN_OPTIONS, type PostsPerScan } from '@/lib/use-posts-per-scan'
import { canonicalTopic } from '@/lib/topics'
import { Icons, Spinner } from '../_components/icons'

function ExploreView() {
  const { watchlist, hydrated, addSubreddit, removeSubreddit } = useWatchlistCtx()
  const scan = useScanCtx()
  const pps = usePostsPerScanCtx()
  const router = useRouter()
  const sp = useSearchParams()

  // URL is the source of truth. Params:
  //   ?topic=foo         — selected scan-trends topic
  //   ?allTimeTopic=foo  — selected all-time topic (mut-ex with topic)
  //   ?trendsTab=all     — Trends panel viewing the all-time list
  // Default trendsTab is 'scan'; omitted from URL when default.
  const urlTopic = sp.get('topic')
  const urlAllTimeTopic = sp.get('allTimeTopic')
  const urlTrendsTab = sp.get('trendsTab') === 'all' ? 'all' : 'scan'

  // Applies a scan-trends topic: updates URL and context atomically, and
  // clears the all-time param since they're mutually exclusive.
  const applyTopic = useCallback(
    (topic: string | null) => {
      scan.selectScanTopic(topic)
      const next = new URLSearchParams(sp.toString())
      if (topic) {
        next.set('topic', topic)
        next.delete('allTimeTopic')
      } else {
        next.delete('topic')
      }
      const qs = next.toString()
      router.replace(qs ? `/explore?${qs}` : '/explore', { scroll: false })
    },
    [router, sp, scan],
  )

  // Trends-tab writer: URL + context, atomic.
  const applyTrendsTab = useCallback(
    (tab: 'scan' | 'all') => {
      scan.setTrendsTab(tab)
      const next = new URLSearchParams(sp.toString())
      if (tab === 'all') next.set('trendsTab', 'all')
      else next.delete('trendsTab')
      const qs = next.toString()
      router.replace(qs ? `/explore?${qs}` : '/explore', { scroll: false })
    },
    [router, sp, scan],
  )

  // Mirror for the all-time topic.
  const applyAllTimeTopic = useCallback(
    (topic: string | null) => {
      scan.selectAllTimeTopic(topic)
      const next = new URLSearchParams(sp.toString())
      if (topic) {
        next.set('allTimeTopic', topic)
        next.delete('topic')
      } else {
        next.delete('allTimeTopic')
      }
      const qs = next.toString()
      router.replace(qs ? `/explore?${qs}` : '/explore', { scroll: false })
    },
    [router, sp, scan],
  )

  // URL → context sync for changes the handlers didn't make: deep links
  // and browser back/forward. Click handlers already keep things in sync.
  useEffect(() => {
    if (urlTopic !== scan.selectedTopic) scan.selectScanTopic(urlTopic)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlTopic])
  useEffect(() => {
    if (urlAllTimeTopic !== scan.selectedAllTimeTopic) {
      scan.selectAllTimeTopic(urlAllTimeTopic)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlAllTimeTopic])
  useEffect(() => {
    if (urlTrendsTab !== scan.trendsTab) scan.setTrendsTab(urlTrendsTab)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlTrendsTab])

  useDropStaleScanTopic(scan.selectedTopic, scan.scanTrends, applyTopic)

  const filteredPosts = scan.selectedTopic
    ? scan.posts.filter((p) => canonicalTopic(p.topic) === scan.selectedTopic)
    : scan.posts

  return (
    <>
      <Topbar title="Explore" posts={scan.posts} />

      <div className="content scroll">
        <WatchlistEditor
          watchlist={watchlist}
          hydrated={hydrated}
          onAdd={addSubreddit}
          onRemove={removeSubreddit}
          onScan={scan.scanAll}
          onStop={scan.stopScan}
          scanning={scan.anyStreaming}
          postsPerScan={pps.postsPerScan}
          postsPerScanOptions={POSTS_PER_SCAN_OPTIONS}
          onChangePostsPerScan={(n) => pps.setPostsPerScan(n as PostsPerScan)}
        />

        <SubSuggester />

        <ErrorsBanner errors={scan.errors} />
        {scan.anyStreaming && <ScanBanner buckets={scan.buckets} order={scan.order} />}

        <BulkDeepScanBar />

        {watchlist.length > 0 && (
          <section className="section">
            <div className="section-head">
              <h2>Scanned subreddits</h2>
            </div>
            <ScannedSubreddits buckets={scan.buckets} order={scan.order} onLoadMore={scan.loadMore} />
          </section>
        )}

        <div className="cols">
          <TrendsPanel
            scanTrends={scan.scanTrends}
            posts={scan.posts}
            selectedTopic={scan.selectedTopic}
            onSelectTopic={applyTopic}
            tab={scan.trendsTab}
            onTabChange={applyTrendsTab}
            allTimeTrends={scan.allTimeTrends}
            allTimeLoading={scan.allTimeLoading}
            allTimeError={scan.allTimeError}
            selectedAllTimeTopic={scan.selectedAllTimeTopic}
            onSelectAllTimeTopic={applyAllTimeTopic}
          />

          <div style={{ position: 'sticky', top: 80 }}>
            {scan.selectedAllTimeTopic ? null : scan.selectedTopic ? (
              <TrendDetailPanel
                topic={scan.selectedTopic}
                posts={filteredPosts}
                insight={scan.trendInsight}
                insightLoading={scan.trendInsightLoading}
                insightError={scan.trendInsightError}
                onClear={() => applyTopic(null)}
              />
            ) : (
              <div className="card empty fade-in">
                <span className="e-ico">
                  <Icons.compass size={26} />
                </span>
                <div>
                  Select a trend to see its breakdown,
                  <br />
                  sentiment split, and AI insight.
                </div>
              </div>
            )}
          </div>
        </div>

        <section className="section" style={{ marginTop: 30 }}>
          <div className="section-head">
            <h2>
              {scan.selectedAllTimeTopic
                ? `Posts · ${scan.selectedAllTimeTopic}`
                : scan.selectedTopic
                ? `Posts · ${scan.selectedTopic}`
                : 'All Classified Posts'}
            </h2>
            <span className="hint">
              {scan.selectedAllTimeTopic
                ? scan.allTimeTopicPosts?.length ?? 0
                : filteredPosts.length}{' '}
              posts
            </span>
          </div>
          {scan.selectedAllTimeTopic ? (
            <AllTimePostsView
              topic={scan.selectedAllTimeTopic}
              posts={scan.allTimeTopicPosts}
              loading={scan.allTimeTopicLoading}
              error={scan.allTimeTopicError}
              onClear={() => applyAllTimeTopic(null)}
              insight={scan.trendInsight}
              insightLoading={scan.trendInsightLoading}
              insightError={scan.trendInsightError}
            />
          ) : (
            <CategoryGroups posts={filteredPosts} />
          )}
        </section>
      </div>
    </>
  )
}

function ExploreFallback() {
  return (
    <>
      <Topbar title="Explore" posts={[]} />
      <div className="content scroll">
        <div className="empty" style={{ padding: 24 }}>
          <Spinner size={16} color="var(--ink-3)" /> Loading explore…
        </div>
      </div>
    </>
  )
}

export default function ExplorePage() {
  return (
    <Suspense fallback={<ExploreFallback />}>
      <ExploreView />
    </Suspense>
  )
}
