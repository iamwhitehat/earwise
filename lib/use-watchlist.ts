'use client'

import { useEffect, useState } from 'react'

const STORAGE_KEY = 'earwise:watchlist'
// Bump to push a refreshed curated set into EXISTING browsers once: on a new
// version the validated subs are MERGED into the saved list (non-destructive —
// keeps anything the user already had).
const SEED_KEY = 'earwise:watchlist:seed'
const SEED_VERSION = '2026-06-operators'

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
    label: 'Tool & ops demand (operators)',
    description: 'Marketing/commerce operators voicing tool + process pain — validated by demand-density research, not guessed',
    subs: [
      'shopify', 'digital_marketing', 'PPC', 'SEO', 'marketing', 'smallbusiness',
      'ecommerce', 'agency', 'AskMarketing', 'sweatystartup', 'Bookkeeping', 'Entrepreneur',
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
      const seedVer = localStorage.getItem(SEED_KEY)
      if (raw === null) {
        // First install → seed the validated set.
        const seeded = [...STARTER_WATCHLIST]
        setWatchlist(seeded)
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
          localStorage.setItem(SEED_KEY, SEED_VERSION)
        } catch {}
      } else {
        const parsed = JSON.parse(raw) as unknown
        const list = Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
        if (seedVer !== SEED_VERSION) {
          // One-time merge: add the refreshed curated subs that aren't already saved.
          const lower = new Set(list.map((s) => s.toLowerCase()))
          for (const s of STARTER_WATCHLIST) if (!lower.has(s.toLowerCase())) list.push(s)
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
            localStorage.setItem(SEED_KEY, SEED_VERSION)
          } catch {}
        }
        setWatchlist(list)
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
