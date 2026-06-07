'use client'

import { useEffect, useState } from 'react'

const STORAGE_KEY = 'earwise:watchlist'

/**
 * Pre-curated watchlist starting points. The first preset is also the
 * fresh-install seed; the others are alternatives the FirstRunGuide
 * surfaces as one-click "switch to" buttons. Subs picked for high post
 * volume and active discussion in their respective niches.
 *
 * Only seed on first install — an empty array stored in localStorage
 * means the user intentionally cleared their watchlist, and we respect
 * that. Presets become re-seed actions in the FirstRunGuide for users
 * who've cleared but still want a quickstart.
 */
export type StarterPreset = {
  key: string
  label: string
  description: string
  subs: readonly string[]
}

export const STARTER_PRESETS: readonly StarterPreset[] = [
  {
    key: 'tool-demand',
    label: 'Affordable-tool demand',
    description: 'People asking for cheap/free tools + alternatives to pricey software',
    subs: [
      'indiehackers', 'smallbusiness', 'selfhosted', 'nocode', 'SideProject',
      'Entrepreneur', 'SaaS', 'freelance', 'ecommerce', 'marketing',
      'EntrepreneurRideAlong', 'AskMarketing',
    ],
  },
  {
    key: 'saas-founder',
    label: 'SaaS founder',
    description: 'Pain points and feature requests from product-led founders',
    subs: ['SaaS', 'startups', 'Entrepreneur'],
  },
  {
    key: 'indie-hacker',
    label: 'Indie hacker',
    description: 'Solo / bootstrap signal from builders shipping in public',
    subs: ['indiehackers', 'SideProject', 'EntrepreneurRideAlong'],
  },
  {
    key: 'dev-tools',
    label: 'Developer tools',
    description: 'Workflows, complaints, and demand for dev-experience tooling',
    subs: ['webdev', 'devops', 'programming'],
  },
]

/** First preset doubles as the fresh-install seed. */
export const STARTER_WATCHLIST: readonly string[] = STARTER_PRESETS[0].subs

function normalize(input: string): string {
  return input.trim().replace(/^\/?r\//i, '').toLowerCase()
}

function isValidSubName(name: string): boolean {
  return /^[a-z0-9_]{2,21}$/i.test(name)
}

export type Watchlist = {
  watchlist: string[]
  hydrated: boolean
  /** Returns null on success, or an error message. */
  addSubreddit: (rawInput: string) => string | null
  removeSubreddit: (sub: string) => void
  /**
   * Replace the watchlist with a starter preset. Used by FirstRunGuide to
   * offer one-click alternatives to the auto-seeded default.
   */
  applyPreset: (key: string) => void
}

export function useWatchlist(): Watchlist {
  const [watchlist, setWatchlist] = useState<string[]>([])
  const [hydrated, setHydrated] = useState(false)

  // Hydrate from localStorage on first mount. First-install detection branches
  // on the KEY presence, not the parsed value: `null` means we've never
  // written, so seed; an explicit `[]` means the user cleared their list and
  // we leave it empty.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw === null) {
        const seeded = [...STARTER_WATCHLIST]
        setWatchlist(seeded)
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
        } catch {}
      } else {
        const parsed = JSON.parse(raw) as unknown
        if (Array.isArray(parsed)) {
          setWatchlist(parsed.filter((v): v is string => typeof v === 'string'))
        }
      }
    } catch {}
    setHydrated(true)
  }, [])

  // Persist on every change once hydrated.
  useEffect(() => {
    if (!hydrated) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(watchlist))
    } catch {}
  }, [watchlist, hydrated])

  function addSubreddit(rawInput: string): string | null {
    const name = normalize(rawInput)
    if (!name) return 'Enter a subreddit name'
    if (!isValidSubName(name)) {
      return 'Names use letters, numbers, and underscores only (2–21 chars)'
    }
    if (watchlist.includes(name)) return `r/${name} is already on the list`
    setWatchlist((prev) => [...prev, name])
    return null
  }

  function removeSubreddit(sub: string) {
    setWatchlist((prev) => prev.filter((s) => s !== sub))
  }

  function applyPreset(key: string) {
    const preset = STARTER_PRESETS.find((p) => p.key === key)
    if (!preset) return
    setWatchlist([...preset.subs])
  }

  return { watchlist, hydrated, addSubreddit, removeSubreddit, applyPreset }
}
