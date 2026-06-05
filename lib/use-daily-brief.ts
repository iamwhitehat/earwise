'use client'

import { useCallback, useEffect, useState } from 'react'
import { dayKey, recordCompletion, type StreakState } from './daily-brief'

// Client-only persistence for the Daily Brief: the streak (cross-day) and today's
// local task completions (publish/scan — reply completion lives server-side in
// lead status). localStorage is fine for v1 (single-user); a server table is the
// later upgrade if cross-device sync is needed.
const KEY = 'earwise:daily-brief'

type Stored = StreakState & { localDate: string; localIds: string[] }
const EMPTY: Stored = { streak: 0, lastCompletedDate: '', localDate: '', localIds: [] }

function read(): Stored {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return EMPTY
    const p = JSON.parse(raw) as Partial<Stored>
    return {
      streak: typeof p.streak === 'number' ? p.streak : 0,
      lastCompletedDate: typeof p.lastCompletedDate === 'string' ? p.lastCompletedDate : '',
      localDate: typeof p.localDate === 'string' ? p.localDate : '',
      localIds: Array.isArray(p.localIds) ? p.localIds.filter((x): x is string => typeof x === 'string') : [],
    }
  } catch {
    return EMPTY
  }
}

function write(s: Stored): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* storage unavailable / quota — non-fatal */
  }
}

export function useDailyBrief() {
  const [state, setState] = useState<Stored>(EMPTY)
  const [hydrated, setHydrated] = useState(false)

  // Hydrate from storage; roll local completions over on a new day.
  useEffect(() => {
    const s = read()
    const today = dayKey(Date.now())
    setState(s.localDate === today ? s : { ...s, localDate: today, localIds: [] })
    setHydrated(true)
  }, [])

  const markLocal = useCallback((id: string) => {
    setState((prev) => {
      if (prev.localIds.includes(id)) return prev
      const next = { ...prev, localIds: [...prev.localIds, id] }
      write(next)
      return next
    })
  }, [])

  // Stamp today as complete + advance the streak. Idempotent within a day.
  const recordBriefComplete = useCallback(() => {
    setState((prev) => {
      const advanced = recordCompletion(prev, Date.now())
      if (advanced === prev) return prev
      const next = { ...prev, ...advanced }
      write(next)
      return next
    })
  }, [])

  return {
    hydrated,
    streak: state.streak,
    localDone: new Set(state.localIds),
    markLocal,
    recordBriefComplete,
  }
}
