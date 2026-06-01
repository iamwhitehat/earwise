// Materialize per-opportunity Advantage Scores into the `opportunities` table
// so ranking is a fast indexed read. Deterministic (no Claude): combines the
// aggregator's demand/monetization/whitespace/momentum signals with FitToYou
// from Business Memory.
import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { aggregateInsights } from './insights-aggregator'
import { loadMemoryFacts } from './memory-db'
import { fitText, DEFAULT_PROJECT } from './memory'
import {
  computeDemand,
  computeMomentum,
  computeFitToYou,
  computeAdvantage,
  DEFAULT_ADVANTAGE_WEIGHTS,
  type AdvantageWeights,
  type AdvantageComponents,
  type MaterializedOpportunity,
} from './advantage'

export type { MaterializedOpportunity }

export async function materializeOpportunities(
  db: SupabaseClient,
  opts: { weights?: AdvantageWeights; projectId?: string } = {},
): Promise<MaterializedOpportunity[]> {
  const projectId = opts.projectId ?? DEFAULT_PROJECT
  const weights = opts.weights ?? DEFAULT_ADVANTAGE_WEIGHTS

  const aggregated = await aggregateInsights(db)
  const memFit = fitText(await loadMemoryFacts(db, projectId))

  const results: MaterializedOpportunity[] = aggregated.opportunities
    .map((o) => {
      const demand = computeDemand({
        posts: o.posts,
        uniqueAuthors: o.uniqueAuthors,
        engagement: o.engagement,
        sourceBreadth: o.confirmedSources.length,
      })
      const momentum = computeMomentum(o.weeklyCounts)
      const fitToYou = computeFitToYou(
        memFit,
        `${o.topic} ${o.examples.map((e) => e.quote).join(' ')}`,
      )
      const components: AdvantageComponents = {
        demand,
        monetization: o.monetization,
        momentum,
        whitespace: o.whitespace,
        fitToYou,
      }
      const adv = computeAdvantage(components, weights)
      return {
        topic: o.topic,
        advantage: adv.score,
        demand,
        monetization: o.monetization,
        momentum,
        whitespace: o.whitespace,
        fitToYou,
        contributions: adv.contributions,
        confirmedSources: o.confirmedSources,
        posts: o.posts,
        subreddits: o.subreddits,
      }
    })
    .sort((a, b) => b.advantage - a.advantage)

  // Full replace for the project so dropped topics don't linger.
  const del = await db.from('opportunities').delete().eq('project_id', projectId)
  if (del.error) throw new Error(`opportunities delete failed: ${del.error.message}`)

  if (results.length > 0) {
    const rows = results.map((r) => ({
      project_id: projectId,
      canonical_topic: r.topic,
      demand: r.demand,
      monetization: r.monetization,
      momentum: r.momentum,
      whitespace: r.whitespace,
      fit_to_you: r.fitToYou,
      advantage_score: r.advantage,
      components: {
        contributions: r.contributions,
        confirmedSources: r.confirmedSources,
        posts: r.posts,
        subreddits: r.subreddits,
        weights,
      },
    }))
    const { error } = await db
      .from('opportunities')
      .upsert(rows, { onConflict: 'project_id,canonical_topic' })
    if (error) throw new Error(`opportunities upsert failed: ${error.message}`)
  }

  return results
}
