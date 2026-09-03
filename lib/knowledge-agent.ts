// Knowledge Agent — the "rewatch and organize" layer (server-side).
//
// Run on a schedule (wired into /api/cron/run) or on demand: it re-reads the
// accumulated market intelligence, asks the model to curate only the durable
// knowledge worth keeping, dedupes it against what business_memory already
// knows, and appends the new facts. Because rewatches dedupe, memory compounds
// instead of duplicating — the agent learns.
//
// Mirrors the memory.ts / memory-db.ts split: pure helpers live in
// lib/knowledge.ts (testable), Claude + Supabase orchestration lives here.

import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { callStructured, MODEL_BULK } from './claude'
import { aggregateInsights, renderAggregatedForClaude } from './insights-aggregator'
import { DEFAULT_PROJECT, type MemoryKind } from './memory'
import { loadMemoryFacts, memoryDigest } from './memory-db'
import { dedupeFacts, normalizeCuratedFacts, type CuratedFact } from './knowledge'

const KNOWLEDGE_TOOL: Anthropic.Messages.Tool = {
  name: 'organize_knowledge',
  description: 'Return the durable market knowledge worth keeping from the intelligence digest.',
  input_schema: {
    type: 'object',
    properties: {
      facts: {
        type: 'array',
        description: 'The knowledge worth keeping. Empty when nothing new or durable.',
        items: {
          type: 'object',
          properties: {
            kind: {
              type: 'string',
              enum: ['market_pain', 'incumbent', 'buyer_language', 'momentum', 'gap'],
            },
            fact: { type: 'string', description: 'One concrete, durable, actionable sentence.' },
            weight: { type: 'number', description: 'Importance 0.5 to 2.' },
            evidence: { type: 'string', description: 'Short source note (topic / tool / quote), or empty.' },
          },
          required: ['kind', 'fact', 'weight'],
        },
      },
    },
    required: ['facts'],
  },
}

const KNOWLEDGE_SYSTEM = `You are the earwise Knowledge Agent. You rewatch the accumulated market intelligence below and extract only the KNOWLEDGE WORTH HAVING — durable, organized facts a founder can use to decide what to build, how to position it, and how to talk to buyers.

Organize every fact into exactly one kind:
- market_pain: a recurring pain — name the audience and the problem (build signal).
- incumbent: a named tool and how buyers feel about it or the gap it leaves (positioning signal).
- buyer_language: a verbatim phrase or framing buyers actually use (copy signal).
- momentum: a topic that is clearly accelerating (timing signal).
- gap: a winnable, under-served opportunity (decision signal).

Rules:
- Each fact is ONE concrete, durable, actionable sentence. No platitudes, no restating a raw post.
- Ground every fact in the evidence given; if you name a tool, it must be one actually named in the digest.
- Weight reflects usefulness: 0.5 minor, 1 useful, 2 must-know.
- If nothing new is worth keeping, return an empty list — padding is worse than silence.`

export async function curateKnowledge(digest: string, memory: string): Promise<CuratedFact[]> {
  const user = `${memory ? memory + '\n\n' : ''}MARKET INTELLIGENCE:\n${digest}`
  const raw = await callStructured<{ facts?: unknown }>(
    MODEL_BULK,
    KNOWLEDGE_SYSTEM,
    user,
    KNOWLEDGE_TOOL,
    2000,
  )
  return normalizeCuratedFacts(raw?.facts)
}

export type KnowledgeRunResult = { curated: number; added: number; skipped: number }

/** Rewatch the market and curate new durable knowledge into business_memory.
 *  Best-effort and idempotent: a repeat run with unchanged data adds nothing. */
export async function runKnowledgeAgent(
  db: SupabaseClient,
  projectId: string = DEFAULT_PROJECT,
): Promise<KnowledgeRunResult> {
  const [aggregated, existing] = await Promise.all([
    aggregateInsights(db),
    loadMemoryFacts(db, projectId),
  ])
  if (aggregated.postCount === 0) return { curated: 0, added: 0, skipped: 0 }

  const digest = renderAggregatedForClaude(aggregated)
  const curated = await curateKnowledge(digest, await memoryDigest(db, projectId))
  if (curated.length === 0) return { curated: 0, added: 0, skipped: 0 }

  const fresh = dedupeFacts(curated, existing)
  const skipped = curated.length - fresh.length
  if (fresh.length === 0) return { curated: curated.length, added: 0, skipped }

  // Insert facts. `evidence` is optional AND its column may not exist yet (the
  // migration may not have run) — so try with it, then fall back to the core
  // columns, so a missing column degrades to facts-without-evidence instead of
  // a failed run.
  const core = fresh.map((f) => ({
    project_id: projectId,
    kind: f.kind as MemoryKind,
    fact: f.fact,
    weight: f.weight,
  }))
  const full = fresh.map((f, i) => (f.evidence ? { ...core[i], evidence: f.evidence } : core[i]))
  let ins = await db.from('business_memory').insert(full)
  if (ins.error) ins = await db.from('business_memory').insert(core)
  if (ins.error) {
    console.warn('[knowledge-agent] insert failed:', ins.error.message)
    return { curated: curated.length, added: 0, skipped }
  }
  return { curated: curated.length, added: fresh.length, skipped }
}
