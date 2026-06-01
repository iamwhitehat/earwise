// Server-side access for the outcome `events` table. Tolerant of an unmigrated
// table — logging is best-effort and reads degrade to empty.
import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_PROJECT } from './memory'
import { isValidEventKind, type AppEvent, type EventEntity, type EventKind } from './events'

export async function logEvent(
  db: SupabaseClient,
  opts: {
    entity: EventEntity
    entityId: string
    kind: EventKind
    payload?: Record<string, unknown>
    projectId?: string
  },
): Promise<void> {
  const { error } = await db.from('events').insert({
    project_id: opts.projectId ?? DEFAULT_PROJECT,
    entity: opts.entity,
    entity_id: opts.entityId,
    kind: opts.kind,
    payload: opts.payload ?? null,
  })
  if (error) console.warn('[events] log failed:', error.message)
}

export async function loadEvents(
  db: SupabaseClient,
  opts: { projectId?: string; limit?: number } = {},
): Promise<AppEvent[]> {
  const { data, error } = await db
    .from('events')
    .select('id, entity, entity_id, kind, payload, created_at')
    .eq('project_id', opts.projectId ?? DEFAULT_PROJECT)
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 5000)
  if (error) {
    console.warn('[events] load failed:', error.message)
    return []
  }
  return (data ?? [])
    .filter((r) => isValidEventKind(r.kind))
    .map((r) => ({
      id: r.id as number,
      entity: r.entity as EventEntity,
      entityId: (r.entity_id as string) ?? '',
      kind: r.kind as EventKind,
      payload: (r.payload as Record<string, unknown> | null) ?? {},
      createdAt: r.created_at ? new Date(r.created_at as string).getTime() : Date.now(),
    }))
}
