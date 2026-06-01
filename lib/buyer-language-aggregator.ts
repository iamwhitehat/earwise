import type { SupabaseClient } from '@supabase/supabase-js'
import type { Category } from './categories'
import { redditPermalink } from './evidence'

const POST_TITLE_SAMPLE = 100
const COMMENT_SAMPLE = 200
const POST_BODY_TRUNC = 300
const COMMENT_BODY_TRUNC = 300
const TOP_TOOLS = 30
const TOOL_CONTEXTS_PER_ITEM = 3

export type EnrichedContext = {
  quote: string
  post_id: string
  subreddit?: string
  category?: Category
  /** Permalink to the source post — lets the UI/synthesis cite real links. */
  url?: string
  /** Source post creation time (epoch ms), when known. */
  postedAt?: number | null
}

export type ToolEntry = {
  text: string
  count: number
  contexts: EnrichedContext[]
}

export type PostMeta = { subreddit: string; category: Category; postedAt: number | null }

export type AggregatedSamples = {
  /** Text samples (with post_id) ready to send to Claude for phrase + emotional extraction. */
  samples: Array<{ post_id: string; text: string }>
  /** Tools aggregated entirely in JS from posts.tools[] — no Claude needed for this. */
  tools: ToolEntry[]
  /** Counts that feed the `stats` jsonb column on the persisted row. */
  stats: { postCount: number; commentCount: number }
  /**
   * post_id → {subreddit, category} lookup, used by the refresh route to
   * enrich Claude-returned contexts so the /language page can filter chips
   * by sub or by category.
   */
  postMeta: Map<string, PostMeta>
}

type PostRow = {
  post_id: string
  subreddit: string
  category: Category
  title: string
  selftext: string | null
  tools: string[] | null
  posted_at: string | null
}

type CommentRow = {
  post_id: string
  body: string
}

export async function aggregateBuyerLanguageSamples(
  db: SupabaseClient,
): Promise<AggregatedSamples> {
  const [postsRes, commentsRes] = await Promise.all([
    db
      .from('posts')
      .select('post_id, subreddit, category, title, selftext, tools, posted_at')
      .neq('category', 'other')
      .order('analyzed_at', { ascending: false })
      .limit(POST_TITLE_SAMPLE),
    db
      .from('post_comments')
      .select('post_id, body')
      .order('analyzed_at', { ascending: false })
      .limit(COMMENT_SAMPLE),
  ])

  if (postsRes.error) throw new Error(`Posts read failed: ${postsRes.error.message}`)
  if (commentsRes.error) throw new Error(`Comments read failed: ${commentsRes.error.message}`)

  const posts = (postsRes.data ?? []) as PostRow[]
  const comments = (commentsRes.data ?? []) as CommentRow[]

  const samples: AggregatedSamples['samples'] = []
  for (const p of posts) {
    const title = (p.title ?? '').trim()
    const body = (p.selftext ?? '').trim().slice(0, POST_BODY_TRUNC)
    const text = body ? `${title} — ${body}` : title
    if (text) samples.push({ post_id: p.post_id, text })
  }
  for (const c of comments) {
    const body = (c.body ?? '').trim().slice(0, COMMENT_BODY_TRUNC)
    if (!body) continue
    samples.push({ post_id: c.post_id, text: body })
  }

  // post_id → metadata lookup. Used both for enriching tool contexts here
  // and (returned to caller) for enriching Claude-returned phrase/emotional
  // contexts in the refresh route. Posts share their sub with all their
  // comments, so comment-derived contexts inherit the post's metadata.
  const postMeta = new Map<string, PostMeta>()
  for (const p of posts) {
    postMeta.set(p.post_id, {
      subreddit: p.subreddit,
      category: p.category,
      postedAt: p.posted_at ? new Date(p.posted_at).getTime() : null,
    })
  }

  // Tools — JS aggregation, no Claude. For each tool, take 1-3 contexts from
  // posts where it appears (post title is the quote, post_id is the source).
  const toolMap = new Map<string, ToolEntry>()
  for (const p of posts) {
    if (!Array.isArray(p.tools)) continue
    for (const raw of p.tools) {
      if (typeof raw !== 'string') continue
      const tool = raw.trim().toLowerCase()
      if (!tool) continue
      let entry = toolMap.get(tool)
      if (!entry) {
        entry = { text: tool, count: 0, contexts: [] }
        toolMap.set(tool, entry)
      }
      entry.count++
      if (entry.contexts.length < TOOL_CONTEXTS_PER_ITEM) {
        entry.contexts.push({
          quote: (p.title ?? '').trim().slice(0, 180),
          post_id: p.post_id,
          subreddit: p.subreddit,
          category: p.category,
          url: redditPermalink(p.subreddit, p.post_id),
          postedAt: p.posted_at ? new Date(p.posted_at).getTime() : null,
        })
      }
    }
  }
  const tools = Array.from(toolMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_TOOLS)

  return {
    samples,
    tools,
    stats: { postCount: posts.length, commentCount: comments.length },
    postMeta,
  }
}

/**
 * Enrich a list of Claude-returned contexts with sub + category looked up
 * from the post metadata. Contexts whose post_id isn't in the map come
 * through with the original shape (no sub/category) — the UI tolerates that.
 */
export function enrichContexts(
  contexts: Array<{ quote: string; post_id: string }>,
  postMeta: Map<string, PostMeta>,
): EnrichedContext[] {
  return contexts.map((c) => {
    const meta = postMeta.get(c.post_id)
    if (!meta) return c
    return {
      ...c,
      subreddit: meta.subreddit,
      category: meta.category,
      url: redditPermalink(meta.subreddit, c.post_id),
      postedAt: meta.postedAt,
    }
  })
}
