// Blog — pure types + markdown assembly. Kept separate from lib/blog.ts (which
// imports the server-only Claude client) so the client screen + unit tests can
// use these without pulling `server-only` into the browser bundle.

export type BlogOutlineSection = { title: string; desc: string }
export type BlogOutline = { title: string; keywords: string[]; sections: BlogOutlineSection[] }
export type BlogPostSection = { title: string; paras: string[]; quote?: string }
export type BlogPost = { lede: string; sections: BlogPostSection[] }

/** Assemble clean markdown from a full post. */
export function blogMarkdown(title: string, post: BlogPost): string {
  let md = `# ${title}\n\n`
  if (post.lede) md += `*${post.lede}*\n\n`
  for (const s of post.sections) {
    md += `## ${s.title}\n\n`
    for (const p of s.paras) md += `${p}\n\n`
    if (s.quote) md += `> ${s.quote}\n\n`
  }
  return md.trimEnd()
}
