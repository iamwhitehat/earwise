// Server access for the per-lead conversation thread (lead_messages). Tolerant
// of an unmigrated table — reads degrade to [] and writes report null.
import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  mapMessageRow,
  MESSAGE_BODY_MAX,
  type LeadMessage,
  type MessageKind,
  type MessageRole,
} from './lead-messages'

const MESSAGE_COLUMNS = 'id, lead_id, role, kind, body, sent, created_at'

export async function loadMessages(db: SupabaseClient, leadId: number): Promise<LeadMessage[]> {
  const { data, error } = await db
    .from('lead_messages')
    .select(MESSAGE_COLUMNS)
    .eq('lead_id', leadId)
    .order('created_at', { ascending: true })
    .limit(500)
  if (error) {
    console.warn('[lead_messages] load failed:', error.message)
    return []
  }
  return (data ?? []).map(mapMessageRow)
}

export async function addMessage(
  db: SupabaseClient,
  opts: { leadId: number; role: MessageRole; kind: MessageKind; body: string; sent?: boolean },
): Promise<LeadMessage | null> {
  const body = opts.body.trim().slice(0, MESSAGE_BODY_MAX)
  if (!body) return null
  const { data, error } = await db
    .from('lead_messages')
    .insert({ lead_id: opts.leadId, role: opts.role, kind: opts.kind, body, sent: opts.sent ?? false })
    .select(MESSAGE_COLUMNS)
    .maybeSingle()
  if (error || !data) {
    console.warn('[lead_messages] add failed:', error?.message ?? 'no row')
    return null
  }
  return mapMessageRow(data)
}

export async function markMessageSent(
  db: SupabaseClient,
  leadId: number,
  messageId: number,
): Promise<LeadMessage | null> {
  const { data, error } = await db
    .from('lead_messages')
    .update({ sent: true })
    .eq('id', messageId)
    .eq('lead_id', leadId)
    .select(MESSAGE_COLUMNS)
    .maybeSingle()
  if (error || !data) return null
  return mapMessageRow(data)
}
