import { describe, it, expect } from 'vitest'
import {
  decodeXml,
  decodeHtml,
  stripTags,
  extractContentText,
  parseAtom,
  parseCommentEntries,
  isTopLevelLink,
} from './reddit-parse'

describe('decoders', () => {
  it('decodeXml unescapes the five XML entities', () => {
    expect(decodeXml('a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;')).toBe(`a & b <c> "d" 'e'`)
  })
  it('decodeHtml handles numeric + named entities', () => {
    expect(decodeHtml('tom&#39;s &amp; jerry&nbsp;x')).toBe("tom's & jerry x")
  })
  it('stripTags removes tags and collapses whitespace', () => {
    expect(stripTags('<p>hi   <b>there</b></p>')).toBe('hi there')
  })
  it('extractContentText pulls the md div out of escaped content', () => {
    const content = '&lt;div class=&quot;md&quot;&gt;I am &lt;b&gt;tired&lt;/b&gt; of it&lt;/div&gt;'
    expect(extractContentText(content)).toBe('I am tired of it')
  })
})

const POST_FEED = `<feed>
<entry>
  <id>t3_abc123</id>
  <title>Need a better CRM &amp; tooling</title>
  <author><name>/u/jane</name></author>
  <content type="html">&lt;div class=&quot;md&quot;&gt;tired of manual work&lt;/div&gt;</content>
  <published>2026-01-15T10:00:00+00:00</published>
</entry>
<entry>
  <id>t3_def456</id>
  <title>Link post</title>
  <author><name>/u/bob</name></author>
  <content type="html"></content>
  <published>2026-01-16T12:00:00+00:00</published>
</entry>
</feed>`

describe('parseAtom', () => {
  it('parses entries, strips fullname prefix, decodes fields', () => {
    const { posts, nextAfter } = parseAtom(POST_FEED, 'SaaS')
    expect(posts).toHaveLength(2)
    expect(posts[0].id).toBe('abc123')
    expect(posts[0].title).toBe('Need a better CRM & tooling')
    expect(posts[0].author).toBe('jane')
    expect(posts[0].selftext).toBe('tired of manual work')
    expect(posts[0].is_self).toBe(true)
    expect(posts[0].permalink).toBe('https://www.reddit.com/r/SaaS/comments/abc123/')
    expect(posts[0].postedAt).toBe(Date.parse('2026-01-15T10:00:00+00:00'))
    // link post with empty content -> no selftext
    expect(posts[1].selftext).toBe('')
    expect(posts[1].is_self).toBe(false)
    // pagination cursor is the last entry's fullname
    expect(nextAfter).toBe('t3_def456')
  })
  it('returns null cursor for an empty feed', () => {
    expect(parseAtom('<feed></feed>', 'x')).toEqual({ posts: [], nextAfter: null })
  })
})

describe('isTopLevelLink', () => {
  it('accepts a top-level comment link and rejects a reply link', () => {
    expect(isTopLevelLink('https://www.reddit.com/r/s/comments/p1/slug/c1/', 'p1')).toBe(true)
    expect(isTopLevelLink('https://www.reddit.com/r/s/comments/p1/slug/parent/c2/', 'p1')).toBe(false)
  })
  it('keeps unknown shapes (does not drop)', () => {
    expect(isTopLevelLink('not a url', 'p1')).toBe(true)
  })
})

const COMMENT_FEED = `<feed>
<entry><id>t3_post1</id><title>the post</title></entry>
<entry>
  <id>t1_c1</id>
  <link href="https://www.reddit.com/r/s/comments/post1/slug/c1/" />
  <author><name>/u/alice</name></author>
  <content type="html">&lt;div class=&quot;md&quot;&gt;great point&lt;/div&gt;</content>
</entry>
<entry>
  <id>t1_c2</id>
  <link href="https://www.reddit.com/r/s/comments/post1/slug/parent/c2/" />
  <author><name>/u/reply</name></author>
  <content type="html">&lt;div class=&quot;md&quot;&gt;a nested reply&lt;/div&gt;</content>
</entry>
<entry>
  <id>t1_c3</id>
  <link href="https://www.reddit.com/r/s/comments/post1/slug/c3/" />
  <author><name>/u/ghost</name></author>
  <content type="html">&lt;div class=&quot;md&quot;&gt;[deleted]&lt;/div&gt;</content>
</entry>
</feed>`

describe('parseCommentEntries', () => {
  it('keeps top-level undeleted comments, skips post/replies/deleted', () => {
    const comments = parseCommentEntries(COMMENT_FEED, 'post1')
    expect(comments).toHaveLength(1)
    expect(comments[0].id).toBe('c1')
    expect(comments[0].author).toBe('alice')
    expect(comments[0].body).toBe('great point')
    expect(comments[0].ups).toBe(0)
  })
  it('respects the cap', () => {
    const feed = `<feed>
      <entry><id>t1_a</id><content type="html">&lt;div class=&quot;md&quot;&gt;one&lt;/div&gt;</content></entry>
      <entry><id>t1_b</id><content type="html">&lt;div class=&quot;md&quot;&gt;two&lt;/div&gt;</content></entry>
    </feed>`
    expect(parseCommentEntries(feed, 'post1', 1)).toHaveLength(1)
  })
})
