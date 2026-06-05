import { describe, it, expect } from 'vitest'
import { blogMarkdown, type BlogPost } from './blog-md'

describe('blogMarkdown', () => {
  const post: BlogPost = {
    lede: 'The lede.',
    sections: [
      { title: 'One', paras: ['Para a.', 'Para b.'] },
      { title: 'Two', paras: ['Para c.'], quote: 'A buyer said this.' },
    ],
  }
  const md = blogMarkdown('My Title', post)

  it('renders title, italic lede, headings, paras, and a blockquote', () => {
    expect(md).toContain('# My Title')
    expect(md).toContain('*The lede.*')
    expect(md).toContain('## One')
    expect(md).toContain('Para a.')
    expect(md).toContain('## Two')
    expect(md).toContain('> A buyer said this.')
  })
  it('omits the lede line when absent and trims trailing whitespace', () => {
    const out = blogMarkdown('T', { lede: '', sections: [{ title: 'S', paras: ['x'] }] })
    expect(out.startsWith('# T\n\n## S')).toBe(true)
    expect(out).toBe(out.trimEnd())
    expect(out).not.toContain('**')
  })
})
