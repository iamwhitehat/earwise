import type { NextRequest } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import {
  resolveSynthModel,
  synthesizeInsightsV2,
} from '@/lib/claude'
import { ingestSources, type IngestQueries } from '@/lib/sources/ingest'
import { recomputeCurrentWeekSnapshots } from '@/lib/snapshots'
import { backfillCanonicalTopics } from '@/lib/topics-db'
import { materializeOpportunities } from '@/lib/advantage-materialize'
import { aggregateInsights, renderAggregatedForClaude } from '@/lib/insights-aggregator'
import { memoryDigest, replaceLearnedFact } from '@/lib/memory-db'
import { loadRecalibration, loadWhatWorkedGuidance } from '@/lib/recalibrate-db'
import { WHATS_WORKING_PREFIX } from '@/lib/recalibrate'
import { buildDigest } from '@/lib/digest'
import { sendDigestEmail, sendPlainEmail, isEmailConfigured } from '@/lib/email'
import { loadHotSignals } from '@/lib/hot-signals-db'
import { selectNewHotAlerts, hotSignalAlert } from '@/lib/alerts'
import { DEFAULT_PROJECT } from '@/lib/memory'

const MAX_QUERIES = 20
const HOT_WINDOW_MS = 24 * 60 * 60 * 1000
const HOT_ALERT_CAP = 5

function strList(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean).slice(0, MAX_QUERIES)
    : []
}

// Auth: when CRON_SECRET is set, require it via `Authorization: Bearer <secret>`
// or `?key=<secret>`. Unset → allowed (localhost / single-user dev).
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  const header = req.headers.get('authorization')
  if (header === `Bearer ${secret}`) return true
  return new URL(req.url).searchParams.get('key') === secret
}

// POST /api/cron/run — the scheduled job. Scans (ingests configured sources),
// re-synthesizes (snapshots, opportunities, insights), builds + stores the
// weekly digest, and emails it if configured. Every step is best-effort so a
// partial failure still produces a digest.
export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown> = {}
  try {
    body = ((await req.json()) ?? {}) as Record<string, unknown>
  } catch {
    body = {}
  }
  const model = resolveSynthModel(body.tier)
  const queries: IngestQueries = {
    reddit: strList(body.subreddits),
    hackernews: strList(body.hackernews),
    stackoverflow: strList(body.stackoverflow),
  }

  let db
  try {
    db = getSupabase()
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Configuration error' },
      { status: 500 }
    )
  }

  const summary: Record<string, unknown> = {}

  // 1. Scan: ingest configured external sources into `signals`.
  const totalQueries =
    (queries.reddit?.length ?? 0) + (queries.hackernews?.length ?? 0) + (queries.stackoverflow?.length ?? 0)
  if (totalQueries > 0) {
    try {
      summary.ingest = await ingestSources(db, queries, { signal: req.signal })
    } catch (err) {
      summary.ingestError = err instanceof Error ? err.message : 'ingest failed'
    }
  }

  // 2. Snapshots (+ canonical backfill).
  try {
    await backfillCanonicalTopics(db)
    summary.snapshotsUpserted = (await recomputeCurrentWeekSnapshots(db)) ?? 0
  } catch (err) {
    summary.snapshotsError = err instanceof Error ? err.message : 'snapshots failed'
  }

  // 3. Materialize Advantage-ranked opportunities, with weights recalibrated
  //    from realized pursue/park outcomes (LEARN). Falls back to defaults until
  //    there are enough decisions to learn from.
  try {
    const recal = await loadRecalibration(db)
    const opps = await materializeOpportunities(db, { weights: recal.weights })
    summary.opportunities = opps.length
    summary.recalibrated = recal.adjusted
  } catch (err) {
    summary.opportunitiesError = err instanceof Error ? err.message : 'materialize failed'
  }

  // 3b. Accrue a private "what's working" learned fact (top converting angles)
  //     so future synthesis + openers are personalized to what actually closes.
  try {
    const guidance = await loadWhatWorkedGuidance(db)
    if (guidance) {
      await replaceLearnedFact(db, WHATS_WORKING_PREFIX, guidance, 1.5)
      summary.learnedWhatsWorking = true
    }
  } catch (err) {
    summary.learnError = err instanceof Error ? err.message : 'learn failed'
  }

  // 3c. Speed-to-lead: detect NEW hot-tier signals in the last 24h and alert
  //     (batched, capped, deduped via `events` rows of kind 'hot_alert'). The
  //     faster this job runs, the closer to real-time the alerting is.
  try {
    const hot = await loadHotSignals(db, { windowMs: HOT_WINDOW_MS, projectId: DEFAULT_PROJECT, limit: 50 })
    const prior = await db.from('events').select('entity_id').eq('kind', 'hot_alert').limit(2000)
    if (prior.error) {
      // Can't dedupe without the events table → skip alerting to avoid re-spam.
      summary.hotAlertSkipped = 'events table absent'
    } else {
      const alreadyAlerted = new Set((prior.data ?? []).map((r) => r.entity_id as string))
      const fresh = selectNewHotAlerts(hot, alreadyAlerted, HOT_ALERT_CAP)
      summary.hotSignalAlerts = fresh.length
      if (fresh.length > 0) {
        await db.from('events').insert(
          fresh.map((s) => ({
            project_id: DEFAULT_PROJECT,
            entity: 'signal',
            entity_id: s.id,
            kind: 'hot_alert',
            payload: { subreddit: s.subreddit, intentType: s.intentType, score: s.score, permalink: s.permalink },
          })),
        )
        const alerts = fresh.map(hotSignalAlert)
        if (isEmailConfigured()) {
          summary.hotAlertEmailed = await sendPlainEmail(
            `🔥 ${alerts.length} hot signal${alerts.length === 1 ? '' : 's'} — reply now`,
            alerts.map((a) => `• ${a.message}`).join('\n'),
          )
        }
      }
    }
  } catch (err) {
    summary.hotAlertError = err instanceof Error ? err.message : 'hot-alert failed'
  }

  // 4. Re-synthesize cross-signal insights (store a new knowledge_insights row).
  try {
    const aggregated = await aggregateInsights(db)
    if (aggregated.postCount > 0) {
      const insights = await synthesizeInsightsV2(
        renderAggregatedForClaude(aggregated),
        model,
        await memoryDigest(db),
      )
      if (insights.length > 0) {
        const stats = {
          postCount: aggregated.postCount,
          deepScanCount: aggregated.deepScanCount,
          topTopics: aggregated.topTopics.slice(0, 10),
          model,
          promptVersion: 'insights-v2',
        }
        await db.from('knowledge_insights').insert({ insights, stats })
        summary.insights = insights.length
      }
    }
  } catch (err) {
    summary.insightsError = err instanceof Error ? err.message : 'insights failed'
  }

  // 5. Build + store the weekly digest, then email it.
  try {
    const brief = await buildDigest(db, { model })
    summary.digest = {
      opportunities: brief.newOpportunities.length,
      accelerating: brief.acceleratingTrends.length,
      leads: brief.freshLeads.length,
      moves: brief.moves.length,
      drafts: brief.drafts.length,
      alerts: brief.alerts.length,
    }
    summary.emailed = await sendDigestEmail(brief)
  } catch (err) {
    summary.digestError = err instanceof Error ? err.message : 'digest failed'
    return Response.json({ ok: false, ...summary }, { status: 500 })
  }

  return Response.json({ ok: true, ...summary })
}
