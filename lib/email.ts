// Optional email delivery for the weekly digest via Resend. Entirely opt-in:
// with no RESEND_API_KEY (or no recipient) every call no-ops. server-only —
// the key must never reach the client.
import 'server-only'

import type { DigestBrief } from './digest-types'

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

function config(): { key: string; to: string; from: string } | null {
  const key = process.env.RESEND_API_KEY
  const to = process.env.DIGEST_EMAIL_TO
  if (!key || key.includes('REPLACE_WITH_YOUR') || !to) return null
  const from = process.env.DIGEST_EMAIL_FROM || 'RedditRadar <onboarding@resend.dev>'
  return { key, to, from }
}

export function isEmailConfigured(): boolean {
  return config() !== null
}

/** Render a plain-text digest for email bodies. */
export function renderDigestText(brief: DigestBrief): string {
  const lines: string[] = [`State of your market — week of ${brief.weekStart}`, '']
  if (brief.alerts.length > 0) {
    lines.push('ALERTS')
    for (const a of brief.alerts) lines.push(`• ${a.message}`)
    lines.push('')
  }
  if (brief.moves.length > 0) {
    lines.push('3 MOVES THIS WEEK')
    brief.moves.forEach((m, i) => lines.push(`${i + 1}. ${m.move} — ${m.why}`))
    lines.push('')
  }
  if (brief.newOpportunities.length > 0) {
    lines.push('TOP OPPORTUNITIES')
    for (const o of brief.newOpportunities) lines.push(`• ${o.topic} (${o.posts} posts)`)
    lines.push('')
  }
  if (brief.predictions.length > 0) {
    lines.push('ABOUT TO SPIKE')
    for (const p of brief.predictions) lines.push(`• ${p.topic}: ${p.weeklyCounts.join(' → ')} → ~${p.projectedNext}`)
    lines.push('')
  }
  if (brief.freshLeads.length > 0) {
    lines.push('FRESH HIGH-INTENT LEADS')
    for (const l of brief.freshLeads) lines.push(`• u/${l.author} in r/${l.subreddit} — ${l.permalink}`)
  }
  return lines.join('\n')
}

/**
 * Send a plain-text email via the configured Resend account. Returns true if
 * sent, false if email isn't configured or the send failed (never throws).
 * Shared by the digest + the batched hot-signal alert.
 */
export async function sendPlainEmail(subject: string, text: string): Promise<boolean> {
  const cfg = config()
  if (!cfg) return false
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: cfg.from, to: cfg.to, subject, text }),
    })
    if (!res.ok) {
      console.warn('[email] send failed:', res.status)
      return false
    }
    return true
  } catch (err) {
    console.warn('[email] send error:', err)
    return false
  }
}

/** Send the weekly digest by email. */
export async function sendDigestEmail(brief: DigestBrief): Promise<boolean> {
  return sendPlainEmail(
    `State of your market — week of ${brief.weekStart}`,
    renderDigestText(brief),
  )
}
