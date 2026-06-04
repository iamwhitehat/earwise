'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useScanCtx } from './scan-provider'
import { Spinner } from './icons'

// ⌘K command palette — the keyboard-first backbone (REDESIGN-SPEC › Global shell).
// Three modes switched with Tab: Go (navigate), Act (run an action), Ask
// (natural-language query over indexed signals, reusing /api/ask → lib/ask).
type Mode = 'go' | 'act' | 'ask'
const MODES: Mode[] = ['go', 'act', 'ask']

type Cmd = { id: string; label: string; hint?: string; run: () => void }

type AskAnswer = {
  answer: string
  citations: { n: number; title: string; url: string; subreddit: string; source: string }[]
}

export const OPEN_CMDK_EVENT = 'earwise:open-cmdk'

// Quick prompts for Ask mode (carried over from the retired dashboard's Ask bar).
const ASK_CHIPS = [
  'What are people most frustrated about?',
  'Which tools do they complain about?',
  'What would they pay for?',
]

export function CommandPalette() {
  const router = useRouter()
  const scan = useScanCtx()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('go')
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const [asking, setAsking] = useState(false)
  const [answer, setAnswer] = useState<AskAnswer | null>(null)
  const [askErr, setAskErr] = useState<string | null>(null)

  const close = useCallback(() => setOpen(false), [])

  // The mode the palette should open into (default Go; a caller can request Ask).
  const pendingMode = useRef<Mode>('go')

  // Global open: ⌘K / Ctrl+K toggles; dispatch OPEN_CMDK_EVENT (optionally with
  // { detail: { mode } }) to open a specific mode — e.g. the Today "Ask" button.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => {
          if (!o) pendingMode.current = 'go'
          return !o
        })
      }
    }
    function onOpen(e: Event) {
      const m = (e as CustomEvent<{ mode?: Mode }>).detail?.mode
      pendingMode.current = m === 'ask' || m === 'act' ? m : 'go'
      setOpen(true)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener(OPEN_CMDK_EVENT, onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener(OPEN_CMDK_EVENT, onOpen)
    }
  }, [])

  // Reset + focus on open (into the requested mode).
  useEffect(() => {
    if (!open) return
    setQuery('')
    setSel(0)
    setMode(pendingMode.current)
    setAnswer(null)
    setAskErr(null)
    const t = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(t)
  }, [open])

  const goCmds: Cmd[] = useMemo(
    () => [
      { id: 'today', label: 'Home', hint: 'today', run: () => { router.push('/today'); close() } },
      { id: 'voice', label: 'Voice · Positioning', hint: 'the words', run: () => { router.push('/voice'); close() } },
      { id: 'words', label: 'Voice · Words', hint: 'customer voice', run: () => { router.push('/voice?view=words'); close() } },
      { id: 'pipeline', label: 'Act · Leads', run: () => { router.push('/pipeline'); close() } },
      { id: 'explore', label: 'Discover', run: () => { router.push('/explore'); close() } },
      { id: 'opps', label: 'Opportunities', hint: 'ranked', run: () => { router.push('/today?view=opportunities'); close() } },
      { id: 'insights', label: 'Insights', run: () => { router.push('/insights'); close() } },
      { id: 'signals', label: 'Signal feed', run: () => { router.push('/today?view=signals'); close() } },
      { id: 'digest', label: 'Digest', run: () => { router.push('/digest'); close() } },
      { id: 'guide', label: 'Plan', run: () => { router.push('/pipeline?view=plan'); close() } },
      { id: 'settings', label: 'Settings', run: () => { router.push('/settings'); close() } },
    ],
    [router, close],
  )

  const actCmds: Cmd[] = useMemo(() => {
    const cmds: Cmd[] = []
    if (scan.anyStreaming) {
      cmds.push({ id: 'stop', label: 'Stop scan', run: () => { scan.stopScan(); close() } })
    } else {
      cmds.push({ id: 'scan', label: 'Run scan', hint: 'watched subs', run: () => { scan.scanAll(); close() } })
    }
    cmds.push({
      id: 'refresh-opps',
      label: 'Refresh opportunities',
      run: () => {
        close()
        void fetch('/api/opportunities/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      },
    })
    cmds.push({ id: 'leads', label: 'Add top signals to Leads', run: () => { router.push('/pipeline'); close() } })
    return cmds
  }, [scan, router, close])

  const q = query.trim().toLowerCase()
  const filtered = useMemo(() => {
    const list = mode === 'go' ? goCmds : mode === 'act' ? actCmds : []
    return q ? list.filter((c) => c.label.toLowerCase().includes(q)) : list
  }, [mode, goCmds, actCmds, q])

  useEffect(() => setSel(0), [mode, query])

  function cycleMode(dir: number) {
    setMode((m) => MODES[(MODES.indexOf(m) + dir + MODES.length) % MODES.length])
  }

  async function runAsk(prompt?: string) {
    const text = (prompt ?? query).trim()
    if (text.length < 3 || asking) return
    if (prompt) setQuery(prompt)
    setAsking(true)
    setAskErr(null)
    setAnswer(null)
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: text }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`)
      setAnswer(json as AskAnswer)
    } catch (err) {
      setAskErr(err instanceof Error ? err.message : 'Ask failed')
    } finally {
      setAsking(false)
    }
  }

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Tab') {
      e.preventDefault()
      cycleMode(e.shiftKey ? -1 : 1)
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
      return
    }
    if (mode === 'ask') {
      if (e.key === 'Enter') {
        e.preventDefault()
        void runAsk()
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSel((s) => Math.min(s + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSel((s) => Math.max(s - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      filtered[sel]?.run()
    }
  }

  if (!open) return null

  return (
    <div className="cmdk-scrim" onClick={close}>
      <div className="cmdk" role="dialog" aria-label="Command palette" onClick={(e) => e.stopPropagation()}>
        <div className="cmdk-modes">
          {MODES.map((m) => (
            <button key={m} type="button" className={`cmdk-mode${m === mode ? ' on' : ''}`} onClick={() => setMode(m)}>
              {m}
            </button>
          ))}
          <span className="cmdk-tab-hint">Tab to switch</span>
        </div>
        <input
          ref={inputRef}
          className="cmdk-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onInputKey}
          placeholder={mode === 'go' ? 'Go to…' : mode === 'act' ? 'Run an action…' : 'Ask your market…'}
          aria-label={`Command palette — ${mode} mode`}
        />

        {mode !== 'ask' && (
          <ul className="cmdk-list">
            {filtered.map((c, i) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={`cmdk-item${i === sel ? ' sel' : ''}`}
                  onMouseEnter={() => setSel(i)}
                  onClick={() => c.run()}
                >
                  <span className="cmdk-label">{c.label}</span>
                  {c.hint && <span className="cmdk-hint">{c.hint}</span>}
                  {i === sel && <span className="cmdk-enter" aria-hidden="true">↵</span>}
                </button>
              </li>
            ))}
            {filtered.length === 0 && <li className="cmdk-empty">No matches</li>}
          </ul>
        )}

        {mode === 'ask' && (
          <div className="cmdk-ask">
            {asking && <div className="cmdk-ask-loading"><Spinner size={13} /> Asking…</div>}
            {askErr && <div className="cmdk-ask-err">{askErr}</div>}
            {answer && (
              <>
                <p className="cmdk-ask-answer">{answer.answer}</p>
                {answer.citations.length > 0 && (
                  <div className="cmdk-ask-cites">
                    {answer.citations.map((ct) => (
                      <a key={ct.n} href={ct.url} target="_blank" rel="noopener noreferrer" className="cmdk-cite">
                        {ct.subreddit ? `r/${ct.subreddit}` : ct.source}
                      </a>
                    ))}
                  </div>
                )}
              </>
            )}
            {!asking && !answer && !askErr && (
              <>
                <div className="cmdk-ask-hint">Ask your market in plain English — answers cite the real threads.</div>
                <div className="cmdk-ask-chips">
                  {ASK_CHIPS.map((c) => (
                    <button key={c} type="button" className="cmdk-ask-chip" onClick={() => void runAsk(c)}>
                      {c}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        <div className="cmdk-foot">
          <span>↑↓ navigate</span>
          <span>↵ run</span>
          <span>Tab mode</span>
          <span>Esc close</span>
        </div>
      </div>
    </div>
  )
}
