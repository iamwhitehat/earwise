# earwise

**A demand index for software that doesn't exist yet.**

earwise reads public developer and founder communities, classifies what people are
complaining about, and scores how *open* each space is — high when people are asking
for something nobody has built, low when the space is already crowded with tools.

Most "idea lists" are one person's opinion in a markdown file. This is a measurement.

---

## The method

Every topic gets a **whitespace score** in `0..1` — an estimate of how unmet the demand is:

```
whitespace = sigmoid( 1.5 · unansweredDemand
                    + 1.3 · incumbentDissatisfaction
                    − 1.8 · solutionSaturation
                    − 0.15 )
```

| Input | What it measures | How it's derived |
|---|---|---|
| `unansweredDemand` | People describing a problem and pointing at no solution | Share of deep-scanned demand posts mentioning no tool |
| `incumbentDissatisfaction` | People actively unhappy with what exists | Tool-complaint share + density of "hate" quotes |
| `solutionSaturation` | How crowded the space already is | Distinct tools mentioned, against a saturation ceiling |

The saturation term is weighted highest and subtracts, so **a loud space with ten
existing tools scores lower than a quiet one with none.** Volume alone is not demand.

Scores are evidence-gated: a topic with no deep scans lands near the neutral-low
middle rather than falsely reading as wide open. Absence of data is not opportunity.

See [`lib/whitespace.ts`](lib/whitespace.ts) — pure, unit-tested, compute-on-read.

---

## Pipeline

```
 sources/          classify           topics/            whitespace/         themes/
 ─────────         ────────           ──────             ──────────          ──────
 reddit       →    pain_point     →   canonical     →    0..1 openness  →    4–6 ranked
 hackernews        feature_request    topic              per topic           build
 stackoverflow     tool_complaint     merge                                  candidates
                   other
```

The final stage collapses over-granular topics into a handful of broad, buildable
themes — each with the recurring pain in one line, a concrete tool idea, and summed
demand. The prompt is explicitly instructed to drop one-offs rather than inflate a
theme, because the failure mode of every demand tool is manufacturing signal from noise.

**Source status:** Reddit, Hacker News, and Stack Overflow are live. YouTube is
probe-only behind a validation gate. Reviews and search are scaffolded stubs that
return `[]` — the connector interface is uniform, so adding a source is a drop-in.

---

## On being a well-behaved scraper

Rate limiting is not an afterthought here; it's [`lib/rate-limiter.ts`](lib/rate-limiter.ts),
and it's one of the more carefully built parts of the codebase.

- **Four priority tiers.** A user waiting on a click jumps ahead of a background
  bulk scan. Anonymous public traffic yields to everything.
- **Minimum gap between call starts**, globally enforced — not per-caller.
- **`pauseFor()` backoff** so a 429 pauses the whole queue, not just the caller that
  tripped it.
- **Injectable clock and timers**, so the scheduling logic is unit-tested with fake
  timers rather than hoped about.

If you fork this: keep it slow. A demand index only works if it can keep collecting.

Aggregate findings and link to sources — never mirror post content.

---

## Quickstart

```bash
npm install
cp .env.local.example .env.local   # fill in the values below
npm run dev                        # http://localhost:3000
```

Required environment:

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Classification and theme synthesis |
| `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_URL` | Database endpoint (client / server) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client-side reads |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side writes — **admin-level, bypasses RLS** |

Schema lives in [`MIGRATIONS.sql`](MIGRATIONS.sql). Full setup notes in [`SETUP.md`](SETUP.md).

```bash
npm test          # 36 test files, vitest
npm run build
```

**Cost note:** synthesis is capped to Haiku by default. The theme pass is a single
call per run and is model-selectable (`?model=fast|balanced|max`).

---

## Layout

| Path | What's in it |
|---|---|
| [`lib/sources/`](lib/sources/) | Connectors behind one `SourceConnector` interface |
| [`lib/whitespace.ts`](lib/whitespace.ts) | The openness scorer |
| [`lib/rate-limiter.ts`](lib/rate-limiter.ts) | Priority-aware outbound scheduling |
| [`lib/topics.ts`](lib/topics.ts) | Topic canonicalization and merging |
| [`lib/claude.ts`](lib/claude.ts) | Structured tool-call wrapper, model tiers |
| [`app/api/sources/`](app/api/sources/) | Ingest, demand, themes, evidence, brief |
| [`app/build/`](app/build/) | Ranked build candidates UI |

~33k lines of TypeScript. Next.js 16, React 19, Supabase, Anthropic SDK.

---

## What this is and isn't

**Is:** a working pipeline that turns public discussion into ranked, evidence-backed
estimates of unmet demand, with the scoring logic exposed rather than hidden behind
a product.

**Isn't:** a guarantee. A high whitespace score means *people are asking and nobody
answered in the data collected* — not that a business exists there. Sampling is
biased toward communities that were scanned, recency windows matter, and a genuinely
unmet need is sometimes unmet because it's a bad idea.

Treat the ranking as a place to start looking, not a verdict.

---

## The local tool (`scripts/`)

The Next.js app needs Supabase. The pipeline in `scripts/` does not — it runs standalone
with a local dashboard and JSON on disk.

```bash
npm run dashboard    # http://localhost:4321
npm run collect      # background collector
npm test
```

**Sessions.** One isolated workspace per niche — its own corpus, knowledge, collector
config and results. This is not filing: topic vocabulary only accumulates inside a single
domain, so mixing niches in one corpus stops the whitespace model from ever running.

**Two clocks.** Collecting is free and rate-limited; classifying costs money. The
collector gathers continuously into an append-only corpus; classification runs in batches
when you ask, and never reads the same post twice.

**It gets better with use.** Every classification is cached by post id, and the topic
vocabulary it has established is fed back into the classifier so labels collide instead
of fragmenting. A review pass merges wording variants into an alias map that applies to
every future run. The claim is measurable — topic reuse rate is reported each run,
alongside effective-topic count so vocabulary collapse is visible rather than flattering.

**What it refuses to do.** Show a whitespace score when no topic recurred. Call a
throttled source missing. Present the niche planner's prior as measured demand. Publish
collected post bodies — `scan-output/` is gitignored, and the rule is aggregate and link,
never mirror.

See [AGENTS.md](AGENTS.md) for architecture, invariants and rate-limit constraints.

## License

MIT
