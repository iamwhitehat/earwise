// Resolves the active project from the request cookie. Server-only. Used by the
// workspace-scoped API routes to filter/tag rows by project_id.
import 'server-only'

import { cookies } from 'next/headers'
import { DEFAULT_PROJECT_ID, isValidProjectId } from './projects'

export const PROJECT_COOKIE = 'rr_project'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365 // 1 year

/** The active project id for this request, or the default workspace. Never throws. */
export async function activeProjectId(): Promise<string> {
  try {
    const store = await cookies()
    const v = store.get(PROJECT_COOKIE)?.value
    return isValidProjectId(v) ? v : DEFAULT_PROJECT_ID
  } catch {
    return DEFAULT_PROJECT_ID
  }
}

/** Set the active-project cookie on the outgoing response (route handlers). */
export async function setActiveProjectId(id: string): Promise<void> {
  const store = await cookies()
  store.set(PROJECT_COOKIE, id, {
    path: '/',
    maxAge: COOKIE_MAX_AGE,
    sameSite: 'lax',
  })
}
