// Early-warning alerts — pure assembly from precomputed signals. The DB reads
// that produce the inputs live in the digest builder; this stays testable.
import { INTENT_TYPE_LABEL, type IntentType } from './intent-patterns'
import type { HotSignal } from './hot-signals'

export type AlertKind = 'acceleration' | 'lead_surge' | 'sentiment' | 'hot_signal'
export type AlertSeverity = 'low' | 'medium' | 'high'

export type Alert = {
  kind: AlertKind
  severity: AlertSeverity
  topic?: string
  message: string
}

export type AlertInputs = {
  /** Topics flagged accelerating, with their weekly trajectory. */
  accelerating: Array<{ topic: string; weeklyCounts: number[] }>
  /** High-intent lead counts this week vs the prior week. */
  leads: { thisWeek: number; lastWeek: number }
  /** Tools with elevated dissatisfaction (hate-quote counts). */
  dissatisfaction: Array<{ tool: string; complaints: number }>
}

const LEAD_SURGE_MIN = 5 // need a meaningful base to call a surge
const LEAD_SURGE_RATIO = 1.5
const DISSATISFACTION_MIN = 3

/** Build the alert list from precomputed inputs. Ordered high → low severity. */
export function buildAlerts(input: AlertInputs): Alert[] {
  const alerts: Alert[] = []

  for (const a of input.accelerating) {
    const traj = a.weeklyCounts.length > 0 ? ` (${a.weeklyCounts.join(' → ')})` : ''
    alerts.push({
      kind: 'acceleration',
      severity: 'high',
      topic: a.topic,
      message: `"${a.topic}" is accelerating${traj} — get in early.`,
    })
  }

  const { thisWeek, lastWeek } = input.leads
  if (thisWeek >= LEAD_SURGE_MIN && thisWeek >= Math.max(1, lastWeek) * LEAD_SURGE_RATIO) {
    alerts.push({
      kind: 'lead_surge',
      severity: 'high',
      message: `${thisWeek} high-intent leads this week, up from ${lastWeek} — reach out while they're warm.`,
    })
  }

  for (const d of input.dissatisfaction) {
    if (d.complaints < DISSATISFACTION_MIN) continue
    alerts.push({
      kind: 'sentiment',
      severity: d.complaints >= 6 ? 'high' : 'medium',
      message: `${d.complaints} people are unhappy with ${d.tool} — a wedge against an incumbent.`,
    })
  }

  const rank: Record<AlertSeverity, number> = { high: 0, medium: 1, low: 2 }
  return alerts.sort((a, b) => rank[a.severity] - rank[b.severity])
}

// ─── Hot-signal alerts (Convert #1, speed-to-lead) ───────────────────────────

/** New hot-tier signals worth alerting on: tier === 'hot', not already alerted,
 *  capped to N (input is assumed already ranked hottest-first). Pure. */
export function selectNewHotAlerts(
  hot: HotSignal[],
  alreadyAlerted: ReadonlySet<string>,
  cap = 5,
): HotSignal[] {
  return hot.filter((s) => s.tier === 'hot' && !alreadyAlerted.has(s.id)).slice(0, cap)
}

/** Render one hot signal as an Alert message. */
export function hotSignalAlert(s: HotSignal): Alert {
  const intent = INTENT_TYPE_LABEL[s.intentType as IntentType] ?? s.intentType
  return {
    kind: 'hot_signal',
    severity: 'high',
    topic: s.topic ?? undefined,
    message: `🔥 u/${s.author} in r/${s.subreddit} — ${intent} (score ${s.score}). Reply now: ${s.permalink}`,
  }
}
