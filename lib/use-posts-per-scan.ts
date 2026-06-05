'use client'

import { useEffect, useState } from 'react'

const STORAGE_KEY = 'earwise:posts-per-scan'

export const POSTS_PER_SCAN_OPTIONS = [25, 50, 100, 200] as const
export type PostsPerScan = (typeof POSTS_PER_SCAN_OPTIONS)[number]

const DEFAULT: PostsPerScan = 100

function isValid(n: unknown): n is PostsPerScan {
  return typeof n === 'number' && (POSTS_PER_SCAN_OPTIONS as readonly number[]).includes(n)
}

export function usePostsPerScan() {
  const [value, setValueState] = useState<PostsPerScan>(DEFAULT)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const n = Number(raw)
        if (isValid(n)) setValueState(n)
      }
    } catch {}
    setHydrated(true)
  }, [])

  function setValue(next: PostsPerScan) {
    setValueState(next)
    try {
      localStorage.setItem(STORAGE_KEY, String(next))
    } catch {}
  }

  return { postsPerScan: value, setPostsPerScan: setValue, hydrated }
}
