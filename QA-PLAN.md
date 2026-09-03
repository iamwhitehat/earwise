# QA & Upgrade Plan — earwise demand scanner

Written after a direct code inspection on 2026-09-03. Every file/line reference was
read from source, not recalled. Findings are the confirmed ones; the fixes reuse code
that already exists rather than introducing frameworks.

## What is already done (don't redo)

- `scripts/audit.ts` — blind Auditor (re-label a sample with Sonnet, measure
  disagreement) + adversarial Skeptic (name products that refute a scored topic).
- Feedback loop: `scoreTopics` (scan-core.ts:730) accepts `refutedTools`, zeroes
  `unansweredDemand` for refuted topics, counts known incumbents as saturation.
  Verified live: 5 false positives collapsed 0.99 → ≤0.13.
- `modelFor()` — Haiku for classify/themes, Sonnet for plan/review, chosen by
  measurement. `evidenceConfidence`/`shrinkToNeutral` rank by evidence weight.
- Demand pre-filter (`looksLikeDemand`) using `INTENT_PATTERNS` + `makerPreflag`.

---

## 1. The one thing that matters

**The scorer measures absence-of-mention, not absence-of-solution.**

`lib/whitespace.ts:12-14` documents "all three inputs are evidence-gated on deep scans
where solution info actually exists." It is a lie:

```
scan-core.ts:779   deepCount: a.total      // every post counts as "deep scanned"
scan-core.ts:780   deepDemand: a.demand
scan-core.ts:781   deepDemandNoTool: unmet // = posts whose body named no tool
```

`unansweredDemand = deepDemandNoTool / deepDemand` then treats "the asker didn't type a
tool name" as "nobody is solving this." Someone asking "what do you use for pipeline
tracking" names no CRM — silence becomes opportunity. A QA run refuted 100% of the top-5
topics this way (Pipedrive, Otter.ai, Jira all exist).

The Skeptic feedback loop is a patch, not a fix: it only covers topics that already
scored > 0.6 and only the first 5, and it is **never re-run after re-scoring** — so the
new leader after a correction is precisely the topic nobody has looked at. (Confirmed:
after the correction, "contract management" led at 0.433, never challenged.)

**Fix, in order:**

1. `challengeTopics` (audit.ts:243) — challenge **every scoreable topic** (a niche
   session has ~7, not 500), not `filter(whitespace > 0.6).slice(0,5)`.
2. `runScan` (scan-core.ts:1026) — loop: score → challenge → re-score with verdicts
   until no topic flips (cap 3 iterations). This turns QA from a report into the
   saturation estimator.
3. Split "no tool named" into two signals before it ever reaches the formula: a demand
   post whose *body* asks for a recommendation but names no tool is "unknown", not
   "unmet". Feed `unknown` posts to the Skeptic rather than into `unansweredDemand`.

Acceptance: re-score the Electrical contractors session → no topic ranks above 0.5
without surviving a challenge; the "contract management" leader is challenged and
corrected too.

---

## 2. Ordered tasks

### Stage A — measurement (unblocks everything else)

| # | Task | Where | Verify | Effort |
|---|---|---|---|---|
| A1 | Challenge all scoreable topics, loop until stable | `audit.ts:243`, `scan-core.ts:1026` | `/api/scan` on electrical corpus → every top topic carries `refutedBy` or `stands` | small |
| A2 | Make "no tool named" a first-class `unknown` signal, not unmet | `scan-core.ts:754`, `lib/whitespace.ts:25` | unit test: ask-style demand post with no tool → not counted in `unansweredDemand` | medium |
| A3 | Fix the header comment in `whitespace.ts` to match reality OR implement real deep-scan gating | `lib/whitespace.ts:12` | doc review | small |
| A4 | Measure `clusterThemes` — it runs on Haiku and has never been measured (the one call site the model split skipped) | `scan-core.ts:838` | run Haiku vs Sonnet on the same topicInput, compare theme coherence | small |

### Stage B — complete the QA system (see §3)

### Stage C — data integrity

| # | Task | Where | Verify | Effort |
|---|---|---|---|---|
| C1 | Verify `applyAlias` is applied at every topic-creation site (classification, review, merge) — an alias not applied downstream silently fragments the vocabulary it was meant to collapse | `knowledge.ts:129` + call sites | grep; add a test that a merged alias never reappears | small |
| C2 | `comments.ts` invalidation deletes `k.posts` and rebuilds `topics` — audit that the rebuild never disagrees with the posts it leaves | `comments.ts` invalidation block | after enrichment, assert `topics` counts == recount from `posts` | small |
| C3 | Crash safety: `appendToCorpus` and collector both append to `corpus.jsonl` — confirm dedup-by-key on read handles a torn/twice-written line | `scan-core.ts:281`, `collector.ts` | unit test on a truncated last line | small |

### Stage D — cost & rate limits

| # | Task | Where | Verify | Effort |
|---|---|---|---|---|
| D1 | Adopt `lib/rate-limiter.ts` (priority queue + 429 backoff) for the classify loop, which currently runs serially with a fixed 2s gap | `scan-core.ts:573`, `lib/rate-limiter.ts` | 600-post classify wall-clock drops, no new 429s | large |
| D2 | Every model call needs a timeout + mid-batch save. Confirm partial classifications persist on API error (currently a batch failure may discard work) | `scan-core.ts:608` | kill the key mid-scan → completed batches survive | medium |

### Stage E — tests (the high-value, no-network suite)

### Stage F — UI honesty

| # | Task | Where | Verify | Effort |
|---|---|---|---|---|
| F1 | The verdict panel thresholds (`demandRate < 0.15`, `perTopic < 1.5`) are arbitrary — tie them to the measured agreement numbers from audit, or label them as heuristics | `dashboard.html` verdict logic | review | small |
| F2 | Surface the audit numbers in the UI (they exist in `/api/state` but render nowhere). A user should see "71% label agreement · 5 findings refuted" | `dashboard.html`, `dashboard.ts` | page shows the QA line | small |

---

## 3. The QA system — what completes it

`scripts/audit.ts` has the two hardest pieces. To be a *system* rather than two
functions, it needs:

1. **A single reported number.** Disagreement (1 − categoryAgree) is the only metric
   that can go badly. Report it first; agreement is flattering by construction.
2. **Trend, not snapshot.** `loadAudit()` already persists runs. Add: agreement over the
   last N runs, and a `drift` flag when tool-presence agreement drops below 0.85 —
   the classifier is the input the scorer is most sensitive to.
3. **Calibration.** The Skeptic's refutations currently *set* the score. A holdout check:
   for topics that later got real comment/tool evidence, did the pre-correction score
   predict it? Without this, "learning" is theater.
4. **Thresholds that mean "stop and fix":**
   - category agreement < 0.70 → classifier prompt is broken, halt scans
   - tool-presence agreement < 0.85 → stop, the saturation input is unreliable
   - Skeptic refutes > 80% of scoreable topics → the corpus has no opening; say so, stop scoring it as if it did
5. **The re-challenge loop** from Stage A — QA must re-run after every re-score, or it
   promotes whatever wasn't looked at.

### Regression suite (all pure, no network, no key)

These functions are testable today. Write `scripts/*.test.ts` (vitest, same runner):

- `evidenceConfidence`: 0 → 0, 6 → 0.5, monotonic → 1
- `shrinkToNeutral`: `(1.0, 1)` ≈ 0.571, always between raw and 0.5
- `scoreTopics`: a 2-post no-tool topic must NOT outrank an 18-post/18-tool topic
- `scoreTopics` with `refutedTools` → whitespace near 0, `unmet` forced 0
- `coerceCategory`: off-enum string → `'other'` (this was the exam_preparation bug)
- `looksLikeDemand`: "not looking for X" → false; "just launched my app" → false
- `mergeTopics`: `posts` count == `topics` count after merge; alias recorded
- `concentration`: all-one-topic → effectiveTopics 1, topShare 1
- `applyAlias` idempotent; merged alias never resurfaces
- `detectProvider` per prefix; `maskKey` never reveals >12 chars; `upsertEnv` idempotent
- `appendToCorpus` dedup by `source:externalId`; torn last line skipped
- `sampleEvenly` deterministic
- `loadRefutedTools` unions across verdicts, drops empty
- `verifySubreddit`: 429 → `'unknown'`, never `'missing'`

Each of these would have caught a real failure from this session's history.

---

## 4. What not to build

- **A tier-3 "strategist" role.** Turning findings into advice is where a demand scanner
  becomes an advice generator. The product's value is saying "I don't know." Keep it.
- **More QA agents for their own sake.** The Auditor and Skeptic cover the two failure
  modes that actually bit (bad labels, false positives). A third agent adds spend, not
  signal, until those two have thresholds and trends.
- **Reddit comment enrichment.** One request per post, already throttled to near-zero.
  Not viable; don't plan around it.
- **Concurrent classification via rate-limiter** before Stage A. Speed on a scorer that
  is wrong is speed into the ground. Fix measurement first.

---

## 5. How we will know it worked

The single observable result: **run a fresh scan on a single-niche session, and every
topic it ranks above 0.5 has either (a) survived a Skeptic challenge, or (b) carries
tool evidence from the posts themselves — and the page shows the QA numbers behind
that claim.** Zero unexamined leaders. When a corpus has no opening, the tool says so
instead of manufacturing one.

Secondary: the regression suite is green, `tsc` clean, and the agreement trend is
visible in the UI rather than buried in a log file.
