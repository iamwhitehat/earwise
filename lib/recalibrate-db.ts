// Server glue for recalibration: load the `events` table and run the pure
// recalibration over it. Tolerant — a missing table yields no events, so
// weights fall back to defaults and guidance is null.
import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { loadEvents } from './events-db'
import { DEFAULT_PROJECT } from './memory'
import {
  buildOutcomeSamples,
  recalibrateWeights,
  whatWorkedGuidance,
  type RecalibrationResult,
} from './recalibrate'

/** Recalibrated Advantage weights from pursue/park outcomes (defaults if too few). */
export async function loadRecalibration(
  db: SupabaseClient,
  projectId: string = DEFAULT_PROJECT,
): Promise<RecalibrationResult> {
  const events = await loadEvents(db, { projectId })
  return recalibrateWeights(buildOutcomeSamples(events))
}

/** One-line "what's working" guidance from the lead funnel, or null. */
export async function loadWhatWorkedGuidance(
  db: SupabaseClient,
  projectId: string = DEFAULT_PROJECT,
): Promise<string | null> {
  const events = await loadEvents(db, { projectId })
  return whatWorkedGuidance(events)
}
