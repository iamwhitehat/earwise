'use client'

import { useEffect, useState } from 'react'

const STORAGE_KEY = 'reddit-reader:sub-suggestions'

type Cache = Record<string, string[]>

function normalizeNiche(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

function loadCache(): Cache {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null) return {}
    const out: Cache = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(v) && v.every((x) => typeof x === 'string')) {
        out[k] = v as string[]
      }
    }
    return out
  } catch {
    return {}
  }
}

function saveCache(cache: Cache) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
  } catch {}
}

export type SubSuggestions = {
  /** Whatever the user last typed (preserved through navigation across re-mounts? no — per-mount). */
  lastNiche: string | null
  /** Result of the last suggest() call. null = nothing requested yet. */
  suggestions: string[] | null
  /** True when the last suggestions came from the localStorage cache (not a fresh Claude call). */
  fromCache: boolean
  loading: boolean
  error: string | null
  suggest: (niche: string) => Promise<void>
  clear: () => void
}

export function useSubSuggestions(): SubSuggestions {
  const [cache, setCache] = useState<Cache>({})
  const [lastNiche, setLastNiche] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<string[] | null>(null)
  const [fromCache, setFromCache] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setCache(loadCache())
  }, [])

  async function suggest(rawNiche: string) {
    const niche = normalizeNiche(rawNiche)
    if (niche.length < 2) {
      setError('Type a niche (at least 2 characters)')
      return
    }
    setError(null)
    setLastNiche(niche)

    const hit = cache[niche]
    if (hit) {
      setSuggestions(hit)
      setFromCache(true)
      return
    }

    setLoading(true)
    setSuggestions(null)
    setFromCache(false)
    try {
      const res = await fetch('/api/suggest-subs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ niche }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `Suggest failed: ${res.status}`)
      const list = (json as { suggestions: string[] }).suggestions
      setSuggestions(list)
      const next = { ...cache, [niche]: list }
      setCache(next)
      saveCache(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Suggest failed')
    } finally {
      setLoading(false)
    }
  }

  function clear() {
    setSuggestions(null)
    setLastNiche(null)
    setError(null)
    setFromCache(false)
  }

  return { lastNiche, suggestions, fromCache, loading, error, suggest, clear }
}
