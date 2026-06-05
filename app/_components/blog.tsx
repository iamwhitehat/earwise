'use client'

import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { blogMarkdown, type BlogOutline, type BlogPost } from '@/lib/blog-md'

// Earwise — Blog generator (handoff Blog.html / spec §6.7). Two steps: an OUTLINE
// you approve (drag to reorder) before spending tokens, then EXPAND into a full
// post + clean markdown to copy. Wired to /api/blog (grounded in the #1
// opportunity + buyer language).
type Phase = 'loading' | 'outline' | 'expanding' | 'post' | 'error'

const Mark = () => (
  <svg width="16" height="16" viewBox="0 0 256 256" aria-hidden="true">
    <g transform="translate(-16 6)">
      <circle cx="96" cy="170" r="15" fill="#0a0c0a" />
      <path d="M135,170 A39,39 0 0 0 96,131" fill="none" stroke="#0a0c0a" strokeWidth="18" strokeLinecap="round" />
      <path d="M167,170 A71,71 0 0 0 96,99" fill="none" stroke="#0a0c0a" strokeWidth="18" strokeLinecap="round" />
      <path d="M199,170 A103,103 0 0 0 96,67" fill="none" stroke="#0a0c0a" strokeWidth="18" strokeLinecap="round" />
    </g>
  </svg>
)

function MarkdownPanel({ md }: { md: string }) {
  const lines = md.split('\n')
  return (
    <pre>{lines.map((ln, i) => {
      const nl = i < lines.length - 1 ? '\n' : ''
      if (ln.startsWith('#')) return <span className="md-h" key={i}>{ln}{nl}</span>
      if (ln.startsWith('>') || (ln.startsWith('*') && ln.endsWith('*'))) return <span className="md-i" key={i}>{ln}{nl}</span>
      return <span key={i}>{ln}{nl}</span>
    })}</pre>
  )
}

export function Blog() {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('loading')
  const [outline, setOutline] = useState<BlogOutline | null>(null)
  const [post, setPost] = useState<BlogPost | null>(null)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState(false)

  const dragIdx = useRef<number | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)

  const fetchOutline = useCallback(async () => {
    setPhase('loading')
    try {
      const r = await fetch('/api/blog', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'outline' }) })
      const j = (await r.json()) as { outline?: BlogOutline; error?: string }
      if (!r.ok || !j.outline) throw new Error(j.error ?? 'No outline returned')
      setOutline(j.outline)
      setPhase('outline')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to build the outline')
      setPhase('error')
    }
  }, [])
  useEffect(() => { fetchOutline() }, [fetchOutline])

  async function expand() {
    if (!outline) return
    setPhase('expanding')
    try {
      const r = await fetch('/api/blog', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'expand', title: outline.title, sections: outline.sections }) })
      const j = (await r.json()) as { post?: BlogPost; error?: string }
      if (!r.ok || !j.post) throw new Error(j.error ?? 'No post returned')
      setPost(j.post)
      setPhase('post')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to expand the post')
      setPhase('outline')
    }
  }

  function onDrop(to: number) {
    const from = dragIdx.current
    setDragging(null); setOver(null); dragIdx.current = null
    if (from == null || from === to || !outline) return
    setOutline((prev) => {
      if (!prev) return prev
      const next = [...prev.sections]
      const [m] = next.splice(from, 1)
      next.splice(to, 0, m)
      return { ...prev, sections: next }
    })
  }
  function addSection() {
    setOutline((prev) => prev ? { ...prev, sections: [...prev.sections, { title: 'New section', desc: 'Describe what this covers — earwise fills it from evidence on expand.' }] } : prev)
  }
  function copyMd() {
    if (!outline || !post) return
    void navigator.clipboard?.writeText(blogMarkdown(outline.title, post)).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const estWords = (outline?.sections.length ?? 0) * 240
  const md = outline && post ? blogMarkdown(outline.title, post) : ''

  return (
    <div className="ew">
      <div className="bg-root">
        <div className="topbar">
          <div className="brand"><div className="mk"><Mark /></div>earwise</div>
          <div className="crumb"><b>Distribute /</b> Blog</div>
          <span className="step-tag">{phase === 'post' ? 'Blog · full post' : 'Blog · outline'}</span>
          <span className="back" onClick={() => (phase === 'post' ? setPhase('outline') : router.push('/drafts'))}>
            {phase === 'post' ? '← Back to outline' : '← Drafts'}
          </span>
        </div>

        {phase === 'loading' && (
          <div className="bg-scroll"><div className="bg-expanding"><div className="spin" /><div className="et">Building your outline from the top opportunity…</div><div className="es">Grounded in real demand + your buyers&apos; words.</div></div></div>
        )}

        {phase === 'error' && (
          <div className="bg-scroll"><div className="bg-outline"><div className="zero"><div className="zmk">¶</div><h3>Couldn&apos;t build the outline</h3><p>{err}</p><div className="act"><button type="button" className="zp" onClick={fetchOutline}>Try again</button></div></div></div></div>
        )}

        {phase === 'outline' && outline && (
          <div className="bg-scroll">
            <div className="bg-outline">
              <div className="blog-head">
                <div className="from">¶ Built from your #1 opportunity + buyer voice</div>
                <div className="title-in">{outline.title}</div>
                {outline.keywords.length > 0 && (
                  <div className="meta">target keywords: {outline.keywords.map((k, i) => (
                    <Fragment key={k}><span className="kw">{k}</span>{i < outline.keywords.length - 1 ? ' · ' : ''}</Fragment>
                  ))}</div>
                )}
              </div>

              <div className="outline-h">
                <span>▾ Outline · {outline.sections.length} sections · drag to reorder</span>
                <span className="est">~{estWords.toLocaleString()} words when expanded</span>
              </div>

              {outline.sections.map((s, i) => (
                <div
                  key={i}
                  className={`osec${dragging === i ? ' dragging' : ''}${over === i ? ' over' : ''}`}
                  draggable
                  onDragStart={() => { dragIdx.current = i; setDragging(i) }}
                  onDragEnd={() => { setDragging(null); setOver(null) }}
                  onDragOver={(e) => { e.preventDefault(); if (over !== i) setOver(i) }}
                  onDrop={() => onDrop(i)}
                >
                  <div className="h">{i + 1}</div>
                  <div className="c"><h5>{s.title}</h5><p>{s.desc}</p></div>
                  <div className="drag" title="Drag to reorder">⠿</div>
                </div>
              ))}

              <div className="blog-actions">
                <button type="button" className="expand" onClick={expand}>Expand to full post →</button>
                <button type="button" className="regen" onClick={fetchOutline}>⟳ Regenerate outline</button>
                <button type="button" className="add" onClick={addSection}>+ Add section</button>
              </div>
            </div>
          </div>
        )}

        {phase === 'expanding' && (
          <div className="bg-scroll"><div className="bg-expanding"><div className="spin" /><div className="et">Expanding {outline?.sections.length ?? 0} sections into a full post…</div><div className="es">This is the token gate — you approved the outline first.</div></div></div>
        )}

        {phase === 'post' && outline && post && (
          <div className="post-split">
            <div className="post-rendered">
              <div className="ph">Preview</div>
              <h1>{outline.title}</h1>
              {post.lede && <div className="lede">{post.lede}</div>}
              {post.sections.map((s, i) => (
                <Fragment key={i}>
                  <h2>{s.title}</h2>
                  {s.paras.map((p, j) => <p key={j}>{p}</p>)}
                  {s.quote && <div className="quote">{s.quote}</div>}
                </Fragment>
              ))}
            </div>
            <div className="post-md">
              <div className="ph">
                <span>Markdown · ready to paste</span>
                <button type="button" className={`copy${copied ? ' done' : ''}`} onClick={copyMd}>{copied ? '✓ Copied' : '⧉ Copy markdown'}</button>
              </div>
              <MarkdownPanel md={md} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
