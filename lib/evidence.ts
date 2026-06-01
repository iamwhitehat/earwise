// A citation that points synthesis output back at a real source. Carried
// through the aggregators so insights/buyer-language can quote a verbatim line
// AND link to where it came from (instead of unverifiable paraphrase).

export type EvidenceRef = {
  quote: string
  url: string
  source: string // 'reddit' for now; multi-source DETECT (Phase 3) adds more
  subreddit?: string
  score?: number // upvotes when available (OAuth pipeline); absent today
  postedAt?: number | null // epoch ms of the source post, when known
}

/** Canonical Reddit permalink from (subreddit, postId). Matches the
 *  deterministic form used elsewhere — the stored permalink column can be
 *  stale, so we always reconstruct. */
export function redditPermalink(subreddit: string, postId: string): string {
  return `https://www.reddit.com/r/${subreddit}/comments/${postId}/`
}
