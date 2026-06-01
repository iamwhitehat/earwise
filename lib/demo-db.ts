// Seeds the demo workspace into the DB under project_id = 'demo'. Idempotent
// (replaces the demo project's rows) and tolerant — each table is best-effort so
// a partially-migrated DB still seeds whatever it can.
import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { computeAdvantage, DEFAULT_ADVANTAGE_WEIGHTS } from './advantage'
import { seedFactsFromProfile } from './memory'
import {
  DEMO_PROJECT,
  DEMO_PROJECT_ID,
  DEMO_PROFILE,
  DEMO_LEARNED_FACTS,
  DEMO_OPPORTUNITIES,
  DEMO_LEADS,
  DEMO_EVENTS,
} from './demo-data'

export async function seedDemoWorkspace(db: SupabaseClient): Promise<Record<string, number>> {
  const summary: Record<string, number> = {}

  // Project row.
  try {
    const { error } = await db
      .from('projects')
      .upsert({ id: DEMO_PROJECT_ID, name: DEMO_PROJECT.name, niche: DEMO_PROJECT.niche }, { onConflict: 'id' })
    if (!error) summary.project = 1
  } catch {
    /* table absent */
  }

  // Business profile.
  try {
    await db.from('business_profile').delete().eq('project_id', DEMO_PROJECT_ID)
    const { error } = await db
      .from('business_profile')
      .insert({ profile: DEMO_PROFILE, project_id: DEMO_PROJECT_ID })
    if (!error) summary.profile = 1
  } catch {
    /* table absent */
  }

  // Business memory (seeded from the profile + a couple of learned facts).
  try {
    await db.from('business_memory').delete().eq('project_id', DEMO_PROJECT_ID)
    const rows = seedFactsFromProfile(DEMO_PROFILE).map((f) => ({
      project_id: DEMO_PROJECT_ID,
      kind: f.kind,
      fact: f.fact,
      weight: f.weight,
    }))
    for (const fact of DEMO_LEARNED_FACTS) {
      rows.push({ project_id: DEMO_PROJECT_ID, kind: 'learned', fact, weight: 1.5 })
    }
    const { error } = await db.from('business_memory').insert(rows)
    if (!error) summary.memory = rows.length
  } catch {
    /* table absent */
  }

  // Materialized opportunities (advantage computed with default weights).
  try {
    await db.from('opportunities').delete().eq('project_id', DEMO_PROJECT_ID)
    const rows = DEMO_OPPORTUNITIES.map((o) => {
      const adv = computeAdvantage(o.components, DEFAULT_ADVANTAGE_WEIGHTS)
      return {
        project_id: DEMO_PROJECT_ID,
        canonical_topic: o.topic,
        demand: o.components.demand,
        monetization: o.components.monetization,
        momentum: o.components.momentum,
        whitespace: o.components.whitespace,
        fit_to_you: o.components.fitToYou,
        advantage_score: adv.score,
        components: {
          contributions: adv.contributions,
          confirmedSources: o.confirmedSources,
          posts: o.posts,
          subreddits: o.subreddits,
          weights: DEFAULT_ADVANTAGE_WEIGHTS,
        },
      }
    })
    const { error } = await db
      .from('opportunities')
      .upsert(rows, { onConflict: 'project_id,canonical_topic' })
    if (!error) summary.opportunities = rows.length
  } catch {
    /* table absent */
  }

  // Leads.
  try {
    await db.from('leads').delete().eq('project_id', DEMO_PROJECT_ID)
    const rows = DEMO_LEADS.map((l) => ({
      project_id: DEMO_PROJECT_ID,
      source: 'reddit',
      kind: l.kind,
      external_id: l.external_id,
      post_id: l.post_id,
      subreddit: l.subreddit,
      permalink: l.permalink,
      author: l.author,
      topic: l.topic,
      intent_type: l.intent_type,
      category: l.category,
      excerpt: l.excerpt,
      opener_draft: l.opener_draft,
      status: l.status,
    }))
    const { error } = await db
      .from('leads')
      .upsert(rows, { onConflict: 'source,external_id', ignoreDuplicates: true })
    if (!error) summary.leads = rows.length
  } catch {
    /* table absent */
  }

  // Outcome events (so the "what's working" panel + recalibration have data).
  try {
    await db.from('events').delete().eq('project_id', DEMO_PROJECT_ID)
    const rows = DEMO_EVENTS.map((e) => ({
      project_id: DEMO_PROJECT_ID,
      entity: e.entity,
      entity_id: e.entityId,
      kind: e.kind,
      payload: e.payload,
    }))
    const { error } = await db.from('events').insert(rows)
    if (!error) summary.events = rows.length
  } catch {
    /* table absent */
  }

  return summary
}
