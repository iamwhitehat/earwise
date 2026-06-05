'use client'

import { useEffect, useState } from 'react'

// Mirrors lib/use-posts-per-scan.ts: a localStorage-backed preference for the
// synthesis model tier used by the Insights + Buyer Language refresh runs.
// Bulk classification always uses Haiku and is NOT affected by this.

const STORAGE_KEY = 'earwise:synth-tier'

export const SYNTH_TIERS = ['fast', 'balanced', 'max'] as const
export type SynthTier = (typeof SYNTH_TIERS)[number]

export const SYNTH_TIER_LABEL: Record<SynthTier, string> = {
  fast: 'Fast',
  balanced: 'Balanced',
  max: 'Max',
}

const DEFAULT: SynthTier = 'balanced'

function isValid(v: unknown): v is SynthTier {
  return typeof v === 'string' && (SYNTH_TIERS as readonly string[]).includes(v)
}

export function useSynthModel() {
  const [tier, setTierState] = useState<SynthTier>(DEFAULT)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (isValid(raw)) setTierState(raw)
    } catch {}
    setHydrated(true)
  }, [])

  function setTier(next: SynthTier) {
    setTierState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {}
  }

  return { tier, setTier, hydrated }
}
