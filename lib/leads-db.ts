// Server-only helpers shared by the leads API routes. Kept out of lib/leads.ts
// so that module stays Supabase-free and unit-testable.
import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { mapLeadRow, type Lead } from './leads'

export const LEADS_MIGRATION_HINT =
  'If the message names a missing table or column, run the Leads migration in SETUP.md (section 2b-decies).'

// Select every column so reads stay column-tolerant across migrations — the
// Convert-core score/tier/follow-up columns are picked up only once they exist,
// and mapLeadRow falls back to nulls when they don't.
export const LEAD_COLUMNS = '*'

/** Load a single lead scoped to the active project. null when not found. */
export async function loadLeadById(
  db: SupabaseClient,
  leadId: number,
  projectId: string,
): Promise<Lead | null> {
  const { data, error } = await db
    .from('leads')
    .select(LEAD_COLUMNS)
    .eq('id', leadId)
    .eq('project_id', projectId)
    .maybeSingle()
  if (error || !data) return null
  return mapLeadRow(data)
}

/** Best-effort persist of a computed Lead Score. Silently no-ops when the
 *  lead_score/tier columns aren't migrated yet (lazy backfill). */
export async function persistLeadScore(
  db: SupabaseClient,
  leadId: number,
  leadScore: number,
  tier: string,
): Promise<void> {
  const { error } = await db.from('leads').update({ lead_score: leadScore, tier }).eq('id', leadId)
  if (error) console.warn('[leads] score persist skipped:', error.message)
}

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
