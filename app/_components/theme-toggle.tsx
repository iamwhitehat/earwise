'use client'

import { useEffect, useState } from 'react'
import { Icons } from './icons'

const STORAGE_KEY = 'reddit-reader:theme'

type Theme = 'light' | 'dark'

/** Read the live theme from <html data-theme>. The pre-paint init script in
 *  layout.tsx is what sets this initially, so any client-side hook needs to
 *  defer to the DOM rather than re-read localStorage (which might lag). */
function readTheme(): Theme {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
}

export function ThemeToggle() {
  // Start as 'light' on the server render so SSR matches the default <html>
  // state; the effect re-reads from the DOM on mount and corrects.
  const [theme, setTheme] = useState<Theme>('light')
  useEffect(() => {
    setTheme(readTheme())
  }, [])

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    if (next === 'dark') document.documentElement.setAttribute('data-theme', 'dark')
    else document.documentElement.removeAttribute('data-theme')
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Storage may be unavailable (private window quota, etc.) — the theme
      // applies for the session; just don't persist.
    }
  }

  const isDark = theme === 'dark'
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {isDark ? <Icons.sun size={14} /> : <Icons.moon size={14} />}
      <span>{isDark ? 'Light' : 'Dark'}</span>
    </button>
  )
}
