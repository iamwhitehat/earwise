// Daily Brief (the discipline-proof rail, spec §6.2) — pure, unit-tested. Builds
// today's short, clearable move-list from live data, and owns the streak/day math.
// No React, no fetch, no server-only — the screen + hook wrap this.
import type { HotSignal } from './hot-signals'
import type { MaterializedOpportunity } from './advantage'
import { leadExternalId, type LeadStatus } from './leads'

export type DailyTaskKind = 'reply' | 'publish' | 'scan' | 'blog' | 'voice'

export type DailyTask = {
  /** Stable id for completion tracking ('reply:<external_id>' | 'publish' | 'scan'). */
  id: string
  kind: DailyTaskKind
  title: string
  meta: string
  done: boolean
  /** Reply tasks carry the signal so the screen can create the lead + open the thread. */
  signal?: HotSignal
  /** Where "open →" navigates for publish (reply uses the signal permalink; scan runs a scan). */
  href?: string
}

/** A small fixed target — clearable in ~10 min, not an infinite feed. */
export const REPLY_TARGET = 3

// Statuses that count as "acted on" → the reply task is done. 'new' = not yet;
// 'passed' = the user skipped it, so it drops off today's list entirely.
const ACTED: ReadonlySet<LeadStatus> = new Set(['contacted', 'replied', 'call', 'customer'])

export type BuildInput = {
  hotSignals: HotSignal[]
  topOpportunity: MaterializedOpportunity | null
  /** external_id → current lead status, from /api/leads (drives reply completion). */
  leadStatus: Map<string, LeadStatus>
  /** Locally-completed task ids for today (publish/scan), from localStorage. */
  localDone: Set<string>
  replyTarget?: number
}

/**
 * Build today's moves: up to N freshest×hottest reply tasks + one "publish a post"
 * from the top opportunity. Never empty — if there's nothing to act on, the one
 * move is "run a scan". Reply completion is derived from real lead status;
 * publish/scan completion comes from `localDone`.
 */
export function buildDailyTasks(input: BuildInput): DailyTask[] {
  const target = input.replyTarget ?? REPLY_TARGET
  const tasks: DailyTask[] = []

  let replies = 0
  for (const s of input.hotSignals) {
    if (replies >= target) break
    const ext = leadExternalId(s.kind, s.id)
    const status = input.leadStatus.get(ext)
    if (status === 'passed') continue // skipped — not on today's list
    replies++
    tasks.push({
      id: `reply:${ext}`,
      kind: 'reply',
      title: `Reply to u/${s.author}`,
      meta: `r/${s.subreddit} · ${s.score}${s.tier === 'hot' ? ' · still warm' : ''}`,
      done: status != null && ACTED.has(status),
      signal: s,
    })
  }

  if (input.topOpportunity) {
    tasks.push({
      id: 'publish',
      kind: 'publish',
      title: 'Publish 1 post',
      meta: `${input.topOpportunity.topic} angle`,
      done: input.localDone.has('publish'),
      href: `/opportunities/${encodeURIComponent(input.topOpportunity.topic)}`,
    })
  }

  // Never blank (spec §8): if there's literally nothing to do, offer a scan.
  if (tasks.length === 0) {
    tasks.push({
      id: 'scan',
      kind: 'scan',
      title: 'Run a scan to surface fresh demand',
      meta: 'no warm leads or opportunities yet',
      done: input.localDone.has('scan'),
    })
  }

  return tasks
}

export function allDone(tasks: DailyTask[]): boolean {
  return tasks.length > 0 && tasks.every((t) => t.done)
}

// ── streak / day math ────────────────────────────────────────────────────────

/** UTC day key 'YYYY-MM-DD' — deterministic + timezone-stable for streak compares. */
export function dayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10)
}

export type StreakState = { streak: number; lastCompletedDate: string }

/**
 * Advance the streak when the brief is completed "now". Idempotent within a day
 * (completing again the same day is a no-op). Completing on the next day continues
 * the streak (+1); any larger gap — or the first ever completion — resets to 1.
 */
export function recordCompletion(prev: StreakState, now: number): StreakState {
  const today = dayKey(now)
  if (prev.lastCompletedDate === today) return prev
  const yesterday = dayKey(now - 86_400_000)
  const streak = prev.lastCompletedDate === yesterday ? prev.streak + 1 : 1
  return { streak, lastCompletedDate: today }
}
