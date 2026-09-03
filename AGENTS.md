<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Working on this repo

## What this project is

A demand scanner. It reads public developer and professional communities, classifies
which posts voice an unmet need, and scores how *open* each topic is — high when people
are asking and nobody has answered, low when the space is already crowded with tools.

Two halves, barely touching:

| half | what it is | state |
|---|---|---|
| `app/`, most of `lib/` | the original Next.js SaaS | needs Supabase; that project is gone, so it does not boot |
| `scripts/` | standalone pipeline + local dashboard | **this is the working part** |

`scripts/` deliberately reuses the pure logic in `lib/` (`whitespace.ts`, `topics.ts`,
`dedup.ts`, `advantage.ts`, `recalibrate.ts`) and none of its Supabase layer.

## Running it

```bash
npm run dashboard    # http://localhost:4321 — the UI, binds to 127.0.0.1 only
npm run collect      # the patient collector (also startable from the UI)
npm run scan         # CLI equivalent of a scan
npm test             # 310 tests, vitest
```

Typecheck with the local binary — `npx tsc` resolves to something else here:

```bash
node node_modules/typescript/bin/tsc --noEmit --skipLibCheck \
  --module esnext --moduleResolution bundler --target es2022 --strict scripts/*.ts
```

## The pipeline

```
collect ─────► corpus.jsonl ─────► classify ─────► score ─────► cluster
(free, slow)   (append-only)      (costs money)   (whitespace)  (themes)
```

Collection and classification run on **different clocks on purpose**: collecting is free
and rate-limited, classifying costs money. Never merge them.

## Invariants — break these and the tool starts lying

1. **Never re-classify a post.** `knowledge.json` caches every classification by
   `source:externalId`. Cost control depends on it.
2. **Done posts leave the pool before any limit applies.** Otherwise "classify newest
   100" spends its budget on posts that cost nothing.
3. **One niche per session.** Topic vocabulary only accumulates inside one domain. A
   mixed corpus of 608 posts produced 185 topics with 7 recurring — the exact failure
   mode sessions exist to prevent.
4. **Pin the session for long operations.** `activeDir()` re-resolves on every call, so
   a switch mid-run splits reads and writes across two sessions. See `enrichWithComments`.
5. **Never present unmeasured output as measured.** The niche planner is a model prior
   and is labelled as one. When no topic clears the threshold the UI says the whitespace
   model did not run, rather than showing a number.
6. **A throttle is never "does not exist."** Reddit 429s constantly. Code that reads an
   empty response as a missing source will delete good ones.
7. **Aggregate and link, never mirror.** `scan-output/` holds scraped post bodies and
   comments and is gitignored. Keep it that way.

## Rate limits are the binding constraint

Reddit is the fragile source and the one that matters most.

- Anonymous RSS only. `about.json` returns **403 for everything** — the JSON API needs OAuth.
- The collector allows at most **one outbound request per 60s globally**, with 25-minute
  intervals per subreddit.
- Connectors swallow HTTP errors and return `[]`, so a 429 is indistinguishable from a
  quiet feed at the call site. The collector treats **three consecutive empties** as a
  failure and backs off exponentially, capped at 4h.
- Reddit comments are not fetched — one request per post is unaffordable. Stack Overflow
  batches 100 questions per call and Hacker News tolerates one call per story, so those
  two are enriched instead.

## Learning

`knowledge.ts` is the part meant to improve with use:

- classifications cached forever, keyed by post
- the established topic vocabulary is fed back into the classifier so labels collide
  instead of fragmenting
- `review.ts` merges wording variants and stores them as an **alias map**, so a merge
  decided once applies to everything afterwards
- one-off topics that never recur get pruned

The falsifiable claim is the **topic reuse rate**, reported every run. It is gameable on
its own — collapsing everything into one bucket scores 100% — so it is always shown next
to **effective topics** (Herfindahl inverse). Rising reuse with falling effective topics
is collapse, not learning; a banner fires when one topic exceeds 40% of labelled posts.

## Gotchas that cost real time

- **Writing TS via shell heredocs mangles `\n` into real newlines**, producing
  unterminated string literals. This broke the build four times in one session. Use an
  editor, or emit the backslash by byte value.
- **A syntax error inside `dashboard.html`'s `<script>` kills the whole page silently** —
  the sidebar renders empty and every button is dead, with no visible error. Check it:
  ```bash
  curl -s localhost:4321/ -o d.html && python -c "import re;open('_c.js','w').write(re.search(r'<script>(.*?)</script>',open('d.html').read(),re.S).group(1))" && node --check _c.js
  ```
- The dashboard is a plain `node:http` server serving one HTML file. No build step, no
  framework — edit `scripts/dashboard.html` directly.

## Layout

| path | role |
|---|---|
| `scripts/dashboard.ts` / `.html` | local server + the entire UI |
| `scripts/scan-core.ts` | collect → classify → score → cluster |
| `scripts/knowledge.ts` | classification cache, vocabulary, forgetting |
| `scripts/review.ts` | vocabulary consolidation with merge guards |
| `scripts/comments.ts` | reply enrichment (Stack Overflow + Hacker News) |
| `scripts/collector.ts` | the patient background collector |
| `scripts/sessions.ts` | one isolated workspace per niche |
| `scripts/provider.ts` | API key detection and live model listing |
| `lib/whitespace.ts` | the openness scorer |
| `lib/topics.ts` | deterministic topic canonicalization |
