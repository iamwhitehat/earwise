// Server-only helpers shared by the leads API routes. Kept out of lib/leads.ts
// so that module stays Supabase-free and unit-testable.
import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

export const LEADS_MIGRATION_HINT =
  'If the message names a missing table or column, run the Leads migration in SETUP.md (section 2b-decies).'

/** Column projection for a full lead row, shared by every leads route. */
export const LEAD_COLUMNS =
  'id, source, kind, external_id, post_id, subreddit, permalink, author, ' +
  'topic, intent_type, category, excerpt, opener_draft, status, notes, ' +
  'created_at, last_event_at'

/**
 * Append a row to lead_events. Best-effort: a logging failure is recorded but
 * never fails the caller's request — the event log is the moat-data seed, not
 * a correctness dependency for the action itself.
 */
export async function logLeadEvent(
  db: SupabaseClient,
  leadId: number,
  kind: string,
  payload?: Record<string, unknown>,
): Promise<void> {
  const { error } = await db
    .from('lead_events')
    .insert({ lead_id: leadId, kind, payload: payload ?? null })
  if (error) console.error('[leads] event log failed:', error)
}

/**
 * Fetch the top recurring buyer-language phrase strings from the most recent
 * buyer_language run, for opener personalization. Tolerant — returns [] if the
 * table is absent or empty so opener generation still works without it.
 */
export async function topBuyerPhrases(db: SupabaseClient, limit = 8): Promise<string[]> {
  try {
    const { data, error } = await db
      .from('buyer_language')
      .select('phrases')
      .order('generated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error || !data) return []
    const phrases = (data.phrases as unknown) as Array<{ text?: unknown }> | null
    if (!Array.isArray(phrases)) return []
    return phrases
      .map((p) => (typeof p?.text === 'string' ? p.text.trim() : ''))
      .filter(Boolean)
      .slice(0, limit)
  } catch {
    return []
  }
}
