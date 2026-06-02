'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Icons } from './icons'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import type { Project } from '@/lib/projects'

// Sign-out is only offered when auth is actually configured (anon key inlined).
const AUTH_ENABLED = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL)

// Workspace switcher in the sidebar. Lists projects, switches the active one
// (sets the rr_project cookie server-side, then reloads so every panel re-reads
// its now project-scoped data), and links to the wizard to create a new one.
export function ProjectSwitcher() {
  const [projects, setProjects] = useState<Project[]>([])
  const [active, setActive] = useState<string>('default')
  const [open, setOpen] = useState(false)
  const [switching, setSwitching] = useState(false)

  async function signOut() {
    try {
      await createSupabaseBrowserClient().auth.signOut()
    } catch {
      /* ignore — redirect to /login regardless */
    }
    window.location.assign('/login')
  }

  useEffect(() => {
    let cancelled = false
    fetch('/api/projects')
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { projects?: Project[]; active?: string } | null) => {
        if (cancelled || !json) return
        if (json.projects) setProjects(json.projects)
        if (json.active) setActive(json.active)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  async function switchTo(id: string) {
    if (id === active || switching) {
      setOpen(false)
      return
    }
    setSwitching(true)
    try {
      const res = await fetch('/api/projects/active', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: id }),
      })
      if (res.ok) {
        // Hard reload so server components + every data fetch re-read the cookie.
        window.location.assign('/')
        return
      }
    } catch {
      /* ignore — leave the menu open so the user can retry */
    }
    setSwitching(false)
  }

  const current = projects.find((p) => p.id === active)
  const label = current?.name ?? 'Default workspace'

  return (
    <div className="proj-switch">
      <button
        type="button"
        className="proj-current"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        title="Switch workspace"
      >
        <Icons.grid size={13} />
        <span className="proj-name">{label}</span>
        <Icons.chev size={13} />
      </button>
      {open && (
        <>
          <div className="proj-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="proj-menu" role="menu">
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                role="menuitemradio"
                aria-checked={p.id === active}
                className={`proj-item${p.id === active ? ' active' : ''}`}
                onClick={() => switchTo(p.id)}
                disabled={switching}
              >
                <span className="proj-item-name">{p.name}</span>
                {p.id === active && <span className="proj-check">✓</span>}
              </button>
            ))}
            <Link href="/welcome" className="proj-new" onClick={() => setOpen(false)}>
              <Icons.plus size={13} /> New workspace
            </Link>
            {AUTH_ENABLED && (
              <button type="button" className="proj-signout" onClick={signOut}>
                <Icons.ext size={13} /> Sign out
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
