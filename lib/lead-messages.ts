// Pure lead-conversation message types/validators shared by the thread API,
// the composer UI, and tests. No Supabase, no server-only.

export const MESSAGE_ROLES = ['outbound', 'inbound'] as const
export type MessageRole = (typeof MESSAGE_ROLES)[number]

export const MESSAGE_KINDS = ['opener', 'follow_up', 'reply', 'objection_response', 'note'] as const
export type MessageKind = (typeof MESSAGE_KINDS)[number]

export function isValidRole(r: unknown): r is MessageRole {
  return typeof r === 'string' && (MESSAGE_ROLES as readonly string[]).includes(r)
}
export function isValidMessageKind(k: unknown): k is MessageKind {
  return typeof k === 'string' && (MESSAGE_KINDS as readonly string[]).includes(k)
}

export const MESSAGE_BODY_MAX = 4000

export type LeadMessage = {
  id: number
  leadId: number
  role: MessageRole
  kind: MessageKind
  body: string
  sent: boolean
  createdAt: number
}

export function mapMessageRow(rowRaw: unknown): LeadMessage {
  const row = (rowRaw ?? {}) as Record<string, unknown>
  const role = row.role
  const kind = row.kind
  return {
    id: row.id as number,
    leadId: row.lead_id as number,
    role: isValidRole(role) ? role : 'outbound',
    kind: isValidMessageKind(kind) ? kind : 'note',
    body: (row.body as string) ?? '',
    sent: row.sent === true,
    createdAt: row.created_at ? new Date(row.created_at as string).getTime() : Date.now(),
  }
}
