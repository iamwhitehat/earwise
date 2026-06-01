// Pure parsers for Reddit's Atom RSS feeds (post listings + comment threads).
// Reddit's anonymous .json endpoint 403s since 2023, so we parse the .rss feed
// with regex (the markup is simple + stable). Extracted here from the posts +
// deep-scan routes so the logic is shared, deduped, and unit-testable.
import { COMMENT_SAMPLE_CAP } from './scan-types'

export function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

export function decodeHtml(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
}

export function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Pull the markdown body out of a Reddit Atom <content> block. */
export function extractContentText(xmlEncodedContent: string): string {
  const html = decodeXml(xmlEncodedContent)
  const m = html.match(/<div class="md">([\s\S]*?)<\/div>/)
  if (!m) return ''
  return decodeHtml(stripTags(m[1]))
}

export type ParsedPost = {
  id: string
  title: string
  author: string
  permalink: string
  selftext: string
  is_self: boolean
  /**
   * Reddit post creation time (epoch ms) from the Atom `<published>` field,
   * or null if the feed didn't include a parseable timestamp. This is the
   * truth source for trend bucketing — `analyzed_at` only tells us when WE
   * found the post, which depends on scan cadence.
   */
  postedAt: number | null
}

export function parseAtom(
  xml: string,
  subreddit: string,
): { posts: ParsedPost[]; nextAfter: string | null } {
  const posts: ParsedPost[] = []
  let lastRawId = ''
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g
  let m: RegExpExecArray | null

  while ((m = entryRe.exec(xml)) !== null) {
    const entry = m[1]
    const rawId = (entry.match(/<id>([^<]+)<\/id>/) ?? [])[1] ?? ''
    if (!rawId) continue
    const id = rawId.replace(/^t\d+_/, '')
    const title = decodeHtml(decodeXml((entry.match(/<title>([^<]+)<\/title>/) ?? [])[1] ?? ''))
    const author = ((entry.match(/<name>([^<]+)<\/name>/) ?? [])[1] ?? '').replace(/^\/u\//, '')
    const content = (entry.match(/<content[^>]*>([\s\S]*?)<\/content>/) ?? [])[1] ?? ''
    const selftext = extractContentText(content)
    const publishedRaw = (entry.match(/<published>([^<]+)<\/published>/) ?? [])[1] ?? ''
    const publishedMs = publishedRaw ? Date.parse(publishedRaw) : NaN
    const postedAt = Number.isFinite(publishedMs) ? publishedMs : null

    posts.push({
      id,
      title,
      author,
      permalink: `https://www.reddit.com/r/${subreddit}/comments/${id}/`,
      selftext,
      is_self: selftext.length > 0,
      postedAt,
    })
    lastRawId = rawId
  }

  // Reddit's listing pagination cursor is the fullname (e.g. t3_xxxxx) of the
  // last entry in the current batch. Posts in new.rss are always t3_; we pass
  // through whatever fullname Reddit gave us.
  return { posts, nextAfter: lastRawId || null }
}

// Returns true when the comment's permalink ends with `…/postId/slug/commentId/`.
// Replies have an extra parent segment: `…/postId/slug/parentId/childId/`.
// We parse the path and look at segment count AFTER the postId.
export function isTopLevelLink(link: string, postId: string): boolean {
  try {
    const u = new URL(link)
    const parts = u.pathname.split('/').filter(Boolean)
    // Expected: r, sub, comments, postId, slug, commentId  (6 parts for top-level)
    // Reply:    r, sub, comments, postId, slug, parentId, commentId  (7 parts)
    const idx = parts.indexOf(postId.toLowerCase()) >= 0
      ? parts.indexOf(postId.toLowerCase())
      : parts.indexOf(postId)
    if (idx < 0) return true // unknown shape — don't drop
    return parts.length - idx === 3
  } catch {
    return true
  }
}

export type ParsedComment = {
  id: string
  body: string
  author: string
  ups: number
}

export function parseCommentEntries(
  xml: string,
  postId: string,
  cap: number = COMMENT_SAMPLE_CAP,
): ParsedComment[] {
  const out: ParsedComment[] = []
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g
  let m: RegExpExecArray | null
  while ((m = entryRe.exec(xml)) !== null) {
    const entry = m[1]
    const rawId = (entry.match(/<id>([^<]+)<\/id>/) ?? [])[1] ?? ''
    if (!rawId.startsWith('t1_')) continue // skip the post entry (t3_) and anything non-comment
    const id = rawId.slice(3)
    const link = (entry.match(/<link href="([^"]+)"/) ?? [])[1] ?? ''
    if (link && !isTopLevelLink(link, postId)) continue
    const author = ((entry.match(/<name>([^<]+)<\/name>/) ?? [])[1] ?? '').replace(/^\/u\//, '')
    const content = (entry.match(/<content[^>]*>([\s\S]*?)<\/content>/) ?? [])[1] ?? ''
    const body = extractContentText(content)
    if (!body || body === '[deleted]' || body === '[removed]') continue
    out.push({ id, body, author, ups: 0 })
    if (out.length >= cap) break
  }
  return out
}
