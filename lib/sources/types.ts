// Multi-source DETECT (Phase 3). A SourceConnector pulls raw signals from one
// external source behind a uniform interface, so new sources are drop-in.
// Pure types — no network, no server-only.

export type SignalEngagement = {
  score?: number // upvotes / points
  comments?: number // reply / answer count
  ratio?: number // upvote ratio or similar, 0..1
}

export type RawSignal = {
  source: string // connector id: 'reddit' | 'hackernews' | 'stackoverflow' | …
  externalId: string // stable id within the source
  title: string
  body: string
  author: string
  url: string
  createdAt: number | null // epoch ms of creation at the source, when known
  engagement: SignalEngagement
}

export interface SourceConnector {
  /** Stable connector id; also the `source` written onto every RawSignal. */
  id: string
  /**
   * Fetch signals for a query. For Reddit the query is a subreddit; for HN /
   * Stack Overflow it's a search term. Implementations must resolve to [] on
   * failure (never throw) so one flaky source can't break ingestion.
   */
  search(query: string, signal?: AbortSignal): Promise<RawSignal[]>
}
