// Unified ingestion: connectors → normalize → classify (Haiku, cached) →
// canonical topic → embed → the `signals` table. Cross-source near-duplicates
// are collapsed by embedding similarity (or normalized-title when embeddings
// aren't configured).
import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { classifyPost, extractTopic } from '../claude'
import { canonicalTopic } from '../topics'
import { postDedupeKey } from '../dedup'
import { embedTexts, cosineSimilarity } from '../embeddings'
import { CONNECTORS, type RawSignal } from './index'

const MAX_NEW_PER_RUN = 60 // cap classification cost/latency per run
const KNOWN_TOPICS_CAP = 300
const DUP_THRESHOLD = 0.92 // cosine; ≥ this between two signals = duplicate
const EMBED_BODY_CHARS = 500

export type IngestQueries = {
  reddit?: string[]
  hackernews?: string[]
  stackoverflow?: string[]
}

export type IngestResult = {
  fetched: number
  alreadyKnown: number
  deduped: number
  inserted: number
  bySource: Record<string, number>
}

type PreparedSignal = RawSignal & {
  category: string
  topic: string | null
  canonicalTopic: string | null
  confidence: string
  embedding: number[] | null
}

export async function ingestSources(
  db: SupabaseClient,
  queries: IngestQueries,
  opts: { signal?: AbortSignal } = {},
): Promise<IngestResult> {
  const bySource: Record<string, number> = {}
  const fetchedSignals: RawSignal[] = []

  // 1. Fetch from each connector for each query.
  const jobs: Array<Promise<void>> = []
  const run = (id: keyof IngestQueries) => {
    for (const q of queries[id] ?? []) {
      const connector = CONNECTORS[id]
      jobs.push(
        connector.search(q, opts.signal).then((sigs) => {
          fetchedSignals.push(...sigs)
        }),
      )
    }
  }
  run('reddit')
  run('hackernews')
  run('stackoverflow')
  await Promise.all(jobs)

  // 2. Dedupe within the batch by (source, externalId).
  const seen = new Set<string>()
  const unique: RawSignal[] = []
  for (const s of fetchedSignals) {
    const key = `${s.source}:${s.externalId}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(s)
  }

  // 3. Filter out signals already stored (cache by source + external_id).
  const existingKeys = await loadExistingKeys(
    db,
    unique.map((s) => ({ source: s.source, externalId: s.externalId })),
  )
  let candidates = unique.filter((s) => !existingKeys.has(`${s.source}:${s.externalId}`))
  const alreadyKnown = unique.length - candidates.length
  if (candidates.length > MAX_NEW_PER_RUN) candidates = candidates.slice(0, MAX_NEW_PER_RUN)

  if (candidates.length === 0) {
    return { fetched: unique.length, alreadyKnown, deduped: 0, inserted: 0, bySource }
  }

  // 4. Classify + canonical topic (Haiku, throttled) per new signal.
  const knownTopics = await loadKnownTopics(db)
  const prepared: PreparedSignal[] = []
  for (const s of candidates) {
    if (opts.signal?.aborted) break
    const body = s.body.trim().slice(0, 800)
    const [classification, topic] = await Promise.all([
      classifyPost(s.title, body),
      extractTopic(s.title, body, knownTopics),
    ])
    prepared.push({
      ...s,
      category: classification.category,
      confidence: classification.confidence,
      topic,
      canonicalTopic: canonicalTopic(topic),
      embedding: null,
    })
  }

  // 5. Embed (optional). Null when embeddings aren't configured.
  const embeddings = await embedTexts(
    prepared.map((p) => `${p.title}\n${p.body.slice(0, EMBED_BODY_CHARS)}`),
  )
  if (embeddings && embeddings.length === prepared.length) {
    prepared.forEach((p, i) => {
      p.embedding = embeddings[i]
    })
  }

  // 6. Cross-source dedup within the batch (embedding similarity, else title).
  const kept: PreparedSignal[] = []
  const keptEmbeddings: number[][] = []
  let deduped = 0
  const titleKeys = new Set<string>()
  for (const p of prepared) {
    let isDup = false
    if (p.embedding) {
      for (const e of keptEmbeddings) {
        if (cosineSimilarity(p.embedding, e) >= DUP_THRESHOLD) {
          isDup = true
          break
        }
      }
    } else {
      const key = postDedupeKey(p.title, p.author)
      if (titleKeys.has(key)) isDup = true
      else titleKeys.add(key)
    }
    if (isDup) {
      deduped++
      continue
    }
    kept.push(p)
    if (p.embedding) keptEmbeddings.push(p.embedding)
  }

  // 7. Insert. Idempotent on (source, external_id); ignore conflicts.
  const rows = kept.map((p) => ({
    source: p.source,
    external_id: p.externalId,
    title: p.title.slice(0, 500),
    body: p.body.slice(0, 8000),
    author: p.author.slice(0, 200),
    url: p.url.slice(0, 600),
    category: p.category,
    topic: p.topic,
    canonical_topic: p.canonicalTopic,
    confidence: p.confidence,
    score: p.engagement.score ?? null,
    num_comments: p.engagement.comments ?? null,
    ratio: p.engagement.ratio ?? null,
    embedding: p.embedding,
    created_at: p.createdAt ? new Date(p.createdAt).toISOString() : null,
  }))

  let inserted = 0
  if (rows.length > 0) {
    const { data, error } = await db
      .from('signals')
      .upsert(rows, { onConflict: 'source,external_id', ignoreDuplicates: true })
      .select('source')
    if (error) throw new Error(`signals insert failed: ${error.message}`)
    inserted = data?.length ?? 0
    for (const r of data ?? []) {
      const src = (r as { source: string }).source
      bySource[src] = (bySource[src] ?? 0) + 1
    }
  }

  // 8. Register the sources that produced data (best-effort).
  await registerSources(db, Object.keys(bySource))

  return { fetched: unique.length, alreadyKnown, deduped, inserted, bySource }
}

async function loadExistingKeys(
  db: SupabaseClient,
  refs: Array<{ source: string; externalId: string }>,
): Promise<Set<string>> {
  if (refs.length === 0) return new Set()
  const sources = Array.from(new Set(refs.map((r) => r.source)))
  const ids = Array.from(new Set(refs.map((r) => r.externalId)))
  const { data, error } = await db
    .from('signals')
    .select('source, external_id')
    .in('source', sources)
    .in('external_id', ids)
  if (error) {
    // Tolerate the table being absent — treat everything as new (the insert
    // will surface a clearer error if it's truly unmigrated).
    console.warn('[ingest] existing-keys read failed:', error.message)
    return new Set()
  }
  const out = new Set<string>()
  for (const r of data ?? []) out.add(`${r.source}:${r.external_id}`)
  return out
}

async function loadKnownTopics(db: SupabaseClient): Promise<string[]> {
  const { data } = await db
    .from('posts')
    .select('topic')
    .not('topic', 'is', null)
    .limit(KNOWN_TOPICS_CAP)
  const set = new Set<string>()
  for (const r of data ?? []) {
    const t = r.topic as string | null
    if (t) set.add(t)
  }
  return Array.from(set)
}

async function registerSources(db: SupabaseClient, ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const { error } = await db
    .from('sources')
    .upsert(ids.map((id) => ({ id, kind: 'connector', enabled: true })), { onConflict: 'id', ignoreDuplicates: true })
  if (error) console.warn('[ingest] source registry upsert failed:', error.message)
}
