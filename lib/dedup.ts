// Crosspost / near-duplicate detection. Pure + testable. The cheap signal is
// a hash of the normalized title plus author — the same person crossposting
// the same thing to several subs, or reposting it, collapses to one. An
// optional embedding-similarity pass can be layered on when embeddings exist
// (see `dedupePosts` opts); absent that, exact normalized-key matching runs.

/** Normalize a title for fuzzy equality: lowercase, strip punctuation,
 *  collapse whitespace, drop a few noise tokens. */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFKD')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ') // strip urls
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(the|a|an|my|our|your|how|to|do|i|is|of|for|in|on)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Stable dedupe key. Same normalized title + same author = duplicate. Author
 * is folded in so two different people legitimately asking a similar question
 * are NOT merged (that's signal, not a crosspost). An empty/unknown author
 * falls back to the title alone so anonymized rows still collapse crossposts.
 */
export function postDedupeKey(title: string, author: string): string {
  const t = normalizeTitle(title)
  const a = (author ?? '').trim().toLowerCase()
  return a && a !== 'unknown' && a !== '[deleted]' ? `${a}::${t}` : `::${t}`
}

export type DedupablePost = {
  title: string
  author: string
}

/**
 * Return the input list with crossposts/near-duplicates removed, keeping the
 * first occurrence of each dedupe key. Stable: relative order is preserved,
 * so callers that pre-sort (e.g. newest-first) keep the newest of a duplicate
 * set. Empty-title rows are passed through untouched (nothing to key on).
 */
export function dedupePosts<T extends DedupablePost>(posts: readonly T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const p of posts) {
    const title = (p.title ?? '').trim()
    if (!title) {
      out.push(p)
      continue
    }
    const key = postDedupeKey(title, p.author)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(p)
  }
  return out
}

/** How many duplicates `dedupePosts` would drop — handy for logging/metrics. */
export function countDuplicates(posts: readonly DedupablePost[]): number {
  return posts.length - dedupePosts(posts).length
}
