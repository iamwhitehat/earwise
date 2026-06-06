// Pure helpers for signal loading — split out of the server-only `signals-db`
// so they're unit-testable (vitest excludes anything importing `server-only`).
// SignalRow is imported type-only, so this stays a pure module.
import type { SignalRow } from './signals-db'

/** Coerce a nullable timestamptz string to epoch ms, or null. */
export function tsToMs(raw: unknown): number | null {
  if (typeof raw !== 'string' || !raw) return null
  const ms = Date.parse(raw)
  return Number.isFinite(ms) ? ms : null
}

/** Pull the subreddit out of a Reddit permalink (…/r/<sub>/comments/…). null
 *  when the url isn't a recognizable Reddit link. */
export function subredditFromUrl(url: string): string | null {
  const m = /reddit\.com\/r\/([A-Za-z0-9_]{2,21})\b/i.exec(url)
  return m ? m[1] : null
}

/** Merge signal lists, keeping the first occurrence of each (kind,id). Used to
 *  union the legacy `posts` path with the unified `signals` table without
 *  double-counting a post that exists in both. Order is preserved. */
export function mergeSignalsByPostId(...lists: SignalRow[][]): SignalRow[] {
  const seen = new Set<string>()
  const out: SignalRow[] = []
  for (const list of lists) {
    for (const s of list) {
      const key = `${s.source ?? 'reddit'}:${s.kind}:${s.id}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(s)
    }
  }
  return out
}
