// Connector registry. Ingestion iterates these; adding a source = adding it
// here (plus its query list). Reddit/HN/Stack Overflow are live; reviews and
// search are scaffolded stubs that return [] until implemented.
import type { SourceConnector } from './types'
import { redditConnector } from './reddit'
import { hackernewsConnector } from './hackernews'
import { stackoverflowConnector } from './stackoverflow'
import { reviewsConnector } from './reviews'
import { searchConnector } from './search'
import { youtubeConnector } from './youtube'

export type { RawSignal, SourceConnector, SignalEngagement } from './types'

export const CONNECTORS: Record<string, SourceConnector> = {
  reddit: redditConnector,
  hackernews: hackernewsConnector,
  stackoverflow: stackoverflowConnector,
  youtube: youtubeConnector, // probe-only via the validation gate; needs YOUTUBE_API_KEY
  reviews: reviewsConnector,
  search: searchConnector,
}

/** Connector ids that actually fetch data in auto-ingest (stubs + unvalidated
 *  probes excluded — YouTube is gate-testable but not auto-ingested until it
 *  proves yield). */
export const LIVE_SOURCE_IDS = ['reddit', 'hackernews', 'stackoverflow'] as const
