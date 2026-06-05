// Blog generator (handoff Blog.html / spec §6.7). Two Claude passes, both via the
// shared callStructured tool-use helper: (1) an OUTLINE the founder approves before
// spending tokens, then (2) EXPAND into a full post. Grounded in the #1 opportunity
// + buyer language so it reads like the market, not a template.
import type Anthropic from '@anthropic-ai/sdk'
import { callStructured, SYNTH_MODELS } from './claude'
import type { BlogOutline, BlogOutlineSection, BlogPost, BlogPostSection } from './blog-md'

export type { BlogOutline, BlogOutlineSection, BlogPost, BlogPostSection } from './blog-md'

const OUTLINE_TOOL: Anthropic.Messages.Tool = {
  name: 'blog_outline',
  description: 'Return a blog post outline: an SEO-friendly title, 3 target keywords, and 4–6 ordered sections.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Compelling, specific, SEO-friendly post title' },
      keywords: { type: 'array', items: { type: 'string' }, description: '3 target search keywords' },
      sections: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            desc: { type: 'string', description: 'One line on what the section covers + which buyer phrase/evidence it uses' },
          },
          required: ['title', 'desc'],
        },
      },
    },
    required: ['title', 'keywords', 'sections'],
  },
}

const POST_TOOL: Anthropic.Messages.Tool = {
  name: 'blog_post',
  description: 'Expand an approved outline into a full post: a one-line italic lede + each section written out.',
  input_schema: {
    type: 'object',
    properties: {
      lede: { type: 'string', description: 'A single punchy italic lede sentence' },
      sections: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            paras: { type: 'array', items: { type: 'string' }, description: '2–3 paragraphs' },
            quote: { type: 'string', description: 'Optional real buyer quote, when one fits' },
          },
          required: ['title', 'paras'],
        },
      },
    },
    required: ['lede', 'sections'],
  },
}

const OUTLINE_SYSTEM = `You are a B2B content strategist for a founder. From the demand signal below, propose ONE evergreen, SEO-friendly blog post outline that helps the reader first and positions the founder's solution softly (never a hard pitch). Use the buyer's own phrases where natural. 4–6 sections, each a distinct beat: open with the real pain, why incumbents fall short, what good looks like, a business-stakes angle, and an actionable close. Return via the blog_outline tool.`

const POST_SYSTEM = `You are a B2B writer. Expand the approved outline into a full post. Keep each section to 2–3 tight paragraphs in a knowledgeable, peer-to-peer voice — concrete, helpful-first, no fluff, no hard sell. Weave in a real buyer quote only where it strengthens a section. Return via the blog_post tool.`

function clampSections<T extends { title: string }>(arr: unknown, map: (o: Record<string, unknown>) => T | null): T[] {
  if (!Array.isArray(arr)) return []
  return arr.map((o) => (o && typeof o === 'object' ? map(o as Record<string, unknown>) : null)).filter((x): x is T => x !== null).slice(0, 8)
}

export async function generateBlogOutline(context: string): Promise<BlogOutline | null> {
  const out = await callStructured<Partial<BlogOutline>>(SYNTH_MODELS.balanced, OUTLINE_SYSTEM, context, OUTLINE_TOOL, 1400)
  if (!out || typeof out.title !== 'string') return null
  return {
    title: out.title.trim(),
    keywords: Array.isArray(out.keywords) ? out.keywords.filter((k): k is string => typeof k === 'string').slice(0, 5) : [],
    sections: clampSections<BlogOutlineSection>(out.sections, (o) =>
      typeof o.title === 'string' && typeof o.desc === 'string' ? { title: o.title, desc: o.desc } : null,
    ),
  }
}

export async function expandBlogPost(title: string, sections: BlogOutlineSection[], context: string): Promise<BlogPost | null> {
  const user = `${context}\n\nTitle: ${title}\nApproved outline (write each in order):\n${sections.map((s, i) => `${i + 1}. ${s.title} — ${s.desc}`).join('\n')}`
  const out = await callStructured<Partial<BlogPost>>(SYNTH_MODELS.balanced, POST_SYSTEM, user, POST_TOOL, 4000)
  if (!out) return null
  return {
    lede: typeof out.lede === 'string' ? out.lede.trim() : '',
    sections: clampSections<BlogPostSection>(out.sections, (o) =>
      typeof o.title === 'string' && Array.isArray(o.paras)
        ? { title: o.title, paras: o.paras.filter((p): p is string => typeof p === 'string'), quote: typeof o.quote === 'string' && o.quote.trim() ? o.quote.trim() : undefined }
        : null,
    ),
  }
}
