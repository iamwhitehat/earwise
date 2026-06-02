// Conversion funnel analytics (Convert #6). Pure + tested. Turns the lead-funnel
// totals (from lib/recalibrate / events) into stages with step conversion rates
// and a single leak flag on the worst-converting step, with a suggested fix.
import type { FunnelTotals } from './recalibrate'

export type FunnelStage = {
  key: string
  label: string
  count: number
  /** Conversion from the previous stage (0..1), or null for the first stage. */
  rate: number | null
  leak: boolean
}

// A step converting below this share of the previous stage is leak-eligible.
const LEAK_THRESHOLD = 0.35
// The previous stage needs at least this many to call a leak (avoid noise).
const LEAK_MIN_BASE = 3

const LEAK_HINT: Record<string, string> = {
  replied: 'Few contacted leads reply — tighten your opener; lead with their problem, not a pitch.',
  call: "Replies aren't converting to calls — make the discovery-call ask sooner and lighter.",
  customer: "Calls aren't closing — revisit your offer and pricing; validate before scaling.",
}

/**
 * Build the funnel stages (Contacted → Replied → Call → Customer), optionally
 * prepended with a Signals stage. Marks the single worst-converting step as the
 * leak when it falls below the threshold and the prior stage has a real base.
 */
export function buildFunnel(totals: FunnelTotals, opts: { signals?: number } = {}): FunnelStage[] {
  const raw: { key: string; label: string; count: number }[] = []
  if (opts.signals != null) raw.push({ key: 'signals', label: 'Signals', count: opts.signals })
  raw.push({ key: 'contacted', label: 'Contacted', count: totals.draftsSent })
  raw.push({ key: 'replied', label: 'Replied', count: totals.replies })
  raw.push({ key: 'call', label: 'Call', count: totals.callsBooked })
  raw.push({ key: 'customer', label: 'Customer', count: totals.conversions })

  const stages: FunnelStage[] = raw.map((s, i) => ({
    ...s,
    rate: i === 0 ? null : raw[i - 1].count > 0 ? s.count / raw[i - 1].count : null,
    leak: false,
  }))

  // Find the worst leak-eligible step.
  let worst: { idx: number; rate: number } | null = null
  for (let i = 1; i < stages.length; i++) {
    const prev = raw[i - 1].count
    const rate = stages[i].rate
    if (rate == null || prev < LEAK_MIN_BASE || rate >= LEAK_THRESHOLD) continue
    if (!worst || rate < worst.rate) worst = { idx: i, rate }
  }
  if (worst) stages[worst.idx].leak = true
  return stages
}

/** The leak stage (or null), with its suggested fix. */
export function funnelLeak(stages: FunnelStage[]): { stage: FunnelStage; hint: string } | null {
  const stage = stages.find((s) => s.leak)
  if (!stage) return null
  return { stage, hint: LEAK_HINT[stage.key] ?? 'This step is leaking — review the message that moves leads forward.' }
}
