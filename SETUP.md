# Setup

The classification + caching layer needs an Anthropic API key and a Supabase
project. Once both are configured in `.env.local`, the app caches every
classified post — you only pay Claude once per Reddit post id, ever.

---

## 1. Anthropic API key

1. Go to https://console.anthropic.com/settings/keys
2. Click **Create Key**, give it a name, copy the `sk-ant-...` value.
3. Open [.env.local](.env.local) and replace the placeholder:

   ```
   ANTHROPIC_API_KEY=sk-ant-...your-key...
   ```

The classifier uses **Claude Haiku 4.5** (`claude-haiku-4-5`) — fast and
inexpensive (~$1 / 1M input tokens). A 50-post subreddit on first load is
roughly 50 × ~150 tokens ≈ ~7.5K input tokens, so well under a cent.

Synthesis (Insights, Buyer Language) is selectable per-run via a
Fast / Balanced / Max dropdown (Haiku / Sonnet 4.6 / Opus 4.6); Balanced is
the default. Bulk classification always uses Haiku regardless.

---

## 1b. (Optional) Embeddings

Topic clustering / dedup can use embeddings when a key is present; without one,
the app falls back to deterministic logic and nothing breaks. To enable, add to
`.env.local`:

```
EMBEDDINGS_API_KEY=...your-voyage-or-compatible-key...
# optional overrides (defaults shown):
# EMBEDDINGS_URL=https://api.voyageai.com/v1/embeddings
# EMBEDDINGS_MODEL=voyage-3-lite
```

Any OpenAI-compatible `POST {input, model} -> {data:[{embedding}]}` endpoint
works. **Leave it unset and everything still works** — `lib/embeddings.ts`
no-ops (returns null) when the key is absent.

---

## 2. Supabase project

### 2a. Create the project

1. Go to https://supabase.com → sign in → **New project**.
2. Name it (e.g. `reddit-reader`), pick a region close to you, set a database
   password (you won't need it again for this app), click **Create new project**.
3. Wait ~1 minute for provisioning.

### 2b. Create the `posts` table

1. In the Supabase dashboard, left sidebar → **SQL Editor** → **New query**.
2. Paste this and click **Run**:

   ```sql
   create table if not exists posts (
     post_id      text        not null,
     subreddit    text        not null,
     title        text        not null,
     selftext     text        not null default '',
     author       text        not null default '',
     permalink    text        not null default '',
     category     text        not null
                  check (category in ('pain_point','feature_request','tool_complaint','other')),
     topic        text,
     analyzed_at  timestamptz not null default now(),
     primary key (post_id, subreddit)
   );

   create index if not exists posts_subreddit_idx on posts (subreddit);
   create index if not exists posts_topic_idx on posts (topic) where topic is not null;
   ```

   The composite primary key on `(post_id, subreddit)` lets the same Reddit id
   appear under multiple subreddits (crossposts) without conflict. The
   `subreddit` index speeds up the per-subreddit dedup lookup the app performs
   on every request. The partial `topic` index speeds up the all-time trends
   aggregation.

### 2b-bis. Migrations (if you set up before topic aggregation)

Already created the table without the `topic` column? Run this once:

```sql
alter table posts add column if not exists topic text;
create index if not exists posts_topic_idx on posts (topic) where topic is not null;
```

Posts already in the table will have `topic = NULL`. They get topic-backfilled
lazily the next time they appear in a scan — no manual reprocessing needed.

### 2b-octies. Migration for comment classification + Buyer Language

Adds a `category` column on `post_comments` (so each comment gets its own
pain/feature/tool/other label during deep scan), plus a `buyer_language`
table that caches the aggregated phrases / tools / emotional-language run.
Run once:

```sql
alter table post_comments add column if not exists category text;

create table if not exists buyer_language (
  id           bigserial primary key,
  phrases      jsonb not null,
  tools        jsonb not null,
  emotional    jsonb not null,
  stats        jsonb not null,
  generated_at timestamptz not null default now()
);
create index if not exists buyer_language_generated_at_idx
  on buyer_language (generated_at desc);
```

Existing comments stay `category = NULL`; future deep scans classify each
comment as part of the same Claude call that extracts tools/quotes.

### 2b-duodecies. Migration for Customer Voice v2 messaging (Phase 2)

Adds a `messaging` jsonb column on `buyer_language` to cache the generated
messaging assets (VoC themes, headlines, landing hero, cold openers, ad
angles, objections, switching triggers, willingness-to-pay). Run once:

```sql
alter table buyer_language add column if not exists messaging jsonb;
```

Reads and writes are tolerant: if the column is absent, the Buyer Language
refresh still saves phrases/tools/emotional (messaging just isn't persisted)
and the page hides the Messaging sections. Run the migration to enable them.

### 2b-nonies. Migration for Reddit post timestamps

Adds a `posted_at` column on `posts` so trend snapshots bucket by the
Reddit post's true creation time (from the Atom `<published>` field), not by
when our scanner happened to find it. Without this, posts surfaced by a
late scan would inflate the current week's trend even if the post itself
was weeks old. Run once:

```sql
alter table posts add column if not exists posted_at timestamptz;
create index if not exists posts_posted_at_idx
  on posts (posted_at desc) where posted_at is not null;
```

Existing rows stay `posted_at = NULL`. They get backfilled lazily the next
time they appear in a scan (the same topic-backfill path that picks up
classification-only rows now also writes `posted_at`). Snapshot recompute
falls back to `analyzed_at` for any row still missing `posted_at`, so
trends keep working through the migration without a manual reprocess.

### 2b-undecies. Migration for canonical topics (Phase 1)

Adds a `canonical_topic` column on `posts` so near-duplicate topic labels
("auth problems" vs "authentication issues") collapse into one trend instead
of fragmenting. Run once:

```sql
alter table posts add column if not exists canonical_topic text;
create index if not exists posts_canonical_topic_idx
  on posts (canonical_topic) where canonical_topic is not null;
```

Existing rows stay `canonical_topic = NULL`. They're filled by a tolerant
backfill (`POST /api/topics/backfill`, also run opportunistically after each
scan via the snapshot refresh) that computes the canonical form from `topic`.
Aggregations don't depend on the column being populated — trends, snapshots,
insights, and topic filtering all derive the canonical form from `topic` at
read time (identical to the stored value in this phase), so everything keeps
working before and after the migration. The stored column is the seam a later
embedding/model-based canonicalization pass writes through.

### 2b-septies. Migration for weekly trend snapshots

Adds a `trend_snapshots` table that stores one row per `(topic, week_start)`
so the app can show trend direction (rising/stable/declining/accelerating)
and an 8-week per-topic chart. Run once:

```sql
create table if not exists trend_snapshots (
  topic             text not null,
  week_start        date not null,
  post_count        int  not null default 0,
  pain_count        int  not null default 0,
  feature_count     int  not null default 0,
  complaint_count   int  not null default 0,
  subreddit_count   int  not null default 0,
  opportunity_score numeric(4,2) not null default 0,
  snapshot_at       timestamptz not null default now(),
  primary key (topic, week_start)
);
create index if not exists trend_snapshots_week_idx
  on trend_snapshots (week_start desc, topic);
```

`week_start` is the calendar date of the ISO Monday for that week (UTC).
The current week is recomputed end-to-end from the `posts` table on every
scan — idempotent, no incremental tracking needed.

### 2b-sexies. Migration for cross-signal Insights page

Adds a `knowledge_insights` table that stores each Claude synthesis run as a
new row (append-only history). The Insights page shows the latest row by
default. Run once:

```sql
create table if not exists knowledge_insights (
  id           bigserial primary key,
  insights     jsonb not null,
  stats        jsonb not null,
  generated_at timestamptz not null default now()
);
create index if not exists knowledge_insights_generated_at_idx
  on knowledge_insights (generated_at desc);
```

`insights` is the array Claude returned. `stats` is a snapshot of the input
size (post count, deep-scan count, top topics) so the UI can show "from N
posts and M deep scans" alongside the timestamp.

### 2b-quinquies. Migration for self-improving classification

Adds a `confidence` column on `posts` so the few-shot classifier can record
how sure it was. Run once:

```sql
alter table posts add column if not exists confidence text;
```

Existing rows stay `NULL` (they predate the few-shot system); future
classifications fill in `'high'`, `'medium'`, or `'low'`.

### 2b-quater. Migration for Deep Scan (comment scraping + insights)

Adds a `post_comments` table to cache raw top-level comments and four columns
on `posts` for the per-post extracted insights + comment count. Run once:

```sql
alter table posts add column if not exists tools text[];
alter table posts add column if not exists quotes jsonb;
alter table posts add column if not exists comments_scanned_at timestamptz;
alter table posts add column if not exists num_comments int;

create table if not exists post_comments (
  comment_id   text primary key,
  post_id      text not null,
  subreddit    text not null,
  body         text not null,
  author       text not null default '',
  upvotes      int  not null default 0,
  analyzed_at  timestamptz not null default now()
);
create index if not exists post_comments_post_idx
  on post_comments (post_id, subreddit);
```

`comments_scanned_at IS NOT NULL` is the "deep scan has run" flag. Comments are
deduped by `comment_id` (Reddit comment ids are globally unique).

`num_comments` is populated only by the Deep Scan flow (counted from the
comments RSS feed). Reddit's anonymous JSON API \(where this field would
normally live\) is fully 403'd as of 2023, so this is a deep-scan-only field.

### 2b-ter. Migration for trend insights

Run this once to enable the Trend Detail Panel's cached AI insight:

```sql
create table if not exists trend_insights (
  topic        text primary key,
  insight      text not null,
  generated_at timestamptz not null default now()
);
```

Each insight is generated once per topic (one Claude call) and cached forever.
Clicking a trend that already has a cached insight is instant.

### 2b-decies. Migration for the Leads pipeline (Phase 5)

Turns high-intent Signals into a tracked outreach pipeline. `leads` holds one
row per person you're pursuing (deduped on `(source, external_id)`);
`lead_events` records every action (created, status change, opener generated /
sent) and is the seed for later outcome-learning — nothing reads it yet. Run
this once:

```sql
create table if not exists leads (
  id bigserial primary key, source text not null default 'reddit',
  kind text not null check (kind in ('post','comment')),
  external_id text not null, post_id text not null, subreddit text not null,
  permalink text not null, author text not null default '',
  topic text, intent_type text, category text, excerpt text not null, opener_draft text,
  status text not null default 'new'
    check (status in ('new','contacted','replied','call','customer','passed')),
  notes text, created_at timestamptz not null default now(),
  last_event_at timestamptz not null default now(), unique (source, external_id) );
create index if not exists leads_status_idx on leads (status, last_event_at desc);
create table if not exists lead_events (
  id bigserial primary key, lead_id bigint not null references leads(id) on delete cascade,
  kind text not null, payload jsonb, created_at timestamptz not null default now() );
create index if not exists lead_events_lead_idx on lead_events (lead_id, created_at);
```

Reads are column-tolerant: if the tables are absent the Leads page surfaces the
migration hint rather than crashing the rest of the app.

### 2b-terdecies. Migration for the Guided strategist (Phase 2)

Stores the founder's business profile and each generated strategy run.
`business_profile` is append-only (latest row wins); `strategy_runs` records
the brief plus the model, prompt version, and a hash of the inputs so runs are
reproducible/traceable. Run once:

```sql
create table if not exists business_profile (
  id bigserial primary key,
  profile jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists business_profile_updated_idx
  on business_profile (updated_at desc);

create table if not exists strategy_runs (
  id bigserial primary key,
  brief jsonb not null,
  model text not null,
  prompt_version text not null,
  inputs_hash text not null,
  created_at timestamptz not null default now()
);
create index if not exists strategy_runs_created_idx
  on strategy_runs (created_at desc);
```

The Guide page surfaces a migration hint if these tables are absent rather than
crashing.

### 2b-quaterdecies. Migration for multi-source signals (Phase 3)

Adds a `sources` registry and a unified `signals` table so demand from Reddit,
Hacker News, and Stack Overflow lands in one place (with a `source` column),
classified + canonical-topic'd + optionally embedded. Run once:

```sql
create table if not exists sources (
  id text primary key,
  kind text not null default 'connector',
  enabled boolean not null default true,
  config jsonb,
  created_at timestamptz not null default now()
);

create table if not exists signals (
  id bigserial primary key,
  source text not null,
  external_id text not null,
  title text not null default '',
  body text,
  author text not null default '',
  url text not null default '',
  category text,
  topic text,
  canonical_topic text,
  confidence text,
  score int,
  num_comments int,
  ratio numeric,
  embedding jsonb,
  created_at timestamptz,
  ingested_at timestamptz not null default now(),
  unique (source, external_id)
);
create index if not exists signals_canonical_idx
  on signals (canonical_topic) where canonical_topic is not null;
create index if not exists signals_source_idx on signals (source);
```

Ingestion is idempotent (deduped on `(source, external_id)`); each new signal
is classified with Haiku, assigned a canonical topic, and embedded when
`EMBEDDINGS_API_KEY` is set (see §1b). The Insights / dashboard pages tolerate
the tables being absent — cross-source confirmation just shows Reddit only.

### 2b-quindecies. Migration for Business Memory + Advantage Score (Phase 4)

`business_memory` holds project-scoped facts (seeded from the business profile,
enriched over time); a compact digest is fed into every synthesis/strategy
prompt. `opportunities` materializes the per-opportunity Advantage Score and its
five component scores so ranking is fast. Run once:

```sql
create table if not exists business_memory (
  id bigserial primary key,
  project_id text not null default 'default',
  kind text not null,
  fact text not null,
  weight numeric not null default 1,
  created_at timestamptz not null default now()
);
create index if not exists business_memory_project_idx on business_memory (project_id);

create table if not exists opportunities (
  id bigserial primary key,
  project_id text not null default 'default',
  canonical_topic text not null,
  demand numeric not null default 0,
  monetization numeric not null default 0,
  momentum numeric not null default 0,
  whitespace numeric not null default 0,
  fit_to_you numeric not null default 0,
  advantage_score numeric not null default 0,
  components jsonb,
  updated_at timestamptz not null default now(),
  unique (project_id, canonical_topic)
);
create index if not exists opportunities_advantage_idx
  on opportunities (project_id, advantage_score desc);
```

Both tables are tolerated when absent: memory just isn't injected, and the
dashboard falls back to its in-memory opportunity ranking. The dashboard
auto-populates `opportunities` on first load when it's empty; recompute any
time with `POST /api/opportunities/refresh` (optionally `{ weights }` to tune
the per-component weights).

### 2b-sexdecies. Migration for weekly digests (Phase 6)

`digests` stores each "State of your market" brief (new opportunities,
accelerating trends, fresh leads, 3 moves, ready drafts, alerts, predictions).
Run once:

```sql
create table if not exists digests (
  id bigserial primary key,
  project_id text not null default 'default',
  period text not null,
  brief jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists digests_created_idx on digests (created_at desc);
```

Generate one in-app on `/digest` (or `POST /api/digest/run`); the scheduled job
(`POST /api/cron/run`) also produces one. The page tolerates the table being
absent. See **§5. Scheduling** below for wiring the cron trigger + optional
email.

### 2b-septendecies. Migration for outcome events / learning (Phase 7)

A general `events` table captures realized outcomes (draft sent, reply, call
booked, conversion, opportunity pursued/parked). Those feed the Advantage Score
weight recalibration, opener guidance, and the "what's working" panel. Run
once:

```sql
create table if not exists events (
  id bigserial primary key,
  project_id text not null default 'default',
  entity text not null,          -- 'lead' | 'opportunity'
  entity_id text not null,       -- lead id, or canonical_topic
  kind text not null,            -- draft_sent | reply | call_booked | conversion | opportunity_pursued | opportunity_parked | lead_passed
  payload jsonb,
  created_at timestamptz not null default now()
);
create index if not exists events_kind_idx on events (project_id, kind, created_at desc);
create index if not exists events_entity_idx on events (entity, entity_id);
```

Everything tolerates this table being absent: events just aren't logged, the
Advantage weights stay at their defaults, and the "what's working" panel hides.

### 2b-duodevicies. Migration for Projects / workspaces (Phase 8)

Projects give each idea its own workspace (its own memory, profile, leads,
opportunities, events). A `projects` table plus a `project_id` column on the
workspace-scoped tables, defaulting to `'default'` so all pre-existing rows
belong to the default workspace (lazy backfill — no data migration needed).
Run once:

```sql
create table if not exists projects (
  id text primary key,                       -- url-safe slug
  name text not null,
  niche text not null default '',
  created_at timestamptz not null default now()
);

-- The workspace that owns all pre-projects data.
insert into projects (id, name) values ('default', 'Default workspace')
  on conflict (id) do nothing;

-- Add project_id to the tables that weren't scoped yet. Existing rows default
-- to the 'default' workspace. (business_memory / opportunities / digests /
-- events already carry project_id from earlier phases.)
alter table leads             add column if not exists project_id text not null default 'default';
alter table business_profile  add column if not exists project_id text not null default 'default';
alter table strategy_runs     add column if not exists project_id text not null default 'default';
alter table signals           add column if not exists project_id text not null default 'default';
alter table sources           add column if not exists project_id text not null default 'default';

create index if not exists leads_project_idx            on leads (project_id, last_event_at desc);
create index if not exists business_profile_project_idx on business_profile (project_id, updated_at desc);
```

The active workspace is held in an `rr_project` cookie and resolved per
request; switch it from the sidebar. Everything tolerates the `projects` table
being absent (a synthetic "Default workspace" is shown) and the `project_id`
columns are additive, so the app keeps working before the migration is run.
Raw scanning (posts/signals ingestion) stays global in v1; the per-workspace
scoping applies to memory, profile, leads, opportunities, and events.

**Demo workspace:** `POST /api/projects/demo` (also reachable as "Browse a demo
first" in the wizard) seeds a fully populated sample workspace — profile,
memory, ranked opportunities, leads, and outcome events — under the `demo`
project, then activates it. It reuses the tables above, so it needs this
migration run first; it's idempotent (re-seeding replaces the demo rows).

### 2b-undevicies. Migration for Convert-core (lead scoring + conversation)

Closes the loop from "reply" to "paying customer": a **Lead Score** + tier on
every lead, a follow-up sequence cursor, and a per-lead **message thread**.
Additive — everything degrades gracefully before it's run (scores are computed
on read and persisted lazily; the conversation thread just shows empty). Run
once:

```sql
alter table leads add column if not exists lead_score int;
alter table leads add column if not exists tier text check (tier in ('hot','warm','cold'));
alter table leads add column if not exists next_follow_up_at timestamptz;
alter table leads add column if not exists sequence_step int not null default 0;
create index if not exists leads_score_idx   on leads (lead_score desc nulls last);
create index if not exists leads_followup_idx on leads (next_follow_up_at) where next_follow_up_at is not null;

create table if not exists lead_messages (
  id         bigserial primary key,
  lead_id    bigint not null references leads(id) on delete cascade,
  role       text not null check (role in ('outbound','inbound')),
  kind       text not null,   -- 'opener' | 'follow_up' | 'reply' | 'objection_response' | 'note'
  body       text not null,
  sent       boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists lead_messages_lead_idx on lead_messages (lead_id, created_at);
```

Tolerance: leads reads use `select('*')` so the new columns are picked up only
once they exist; Lead Score is computed in-memory on every read (authoritative)
and best-effort persisted when the columns are present — so the board sorts
hot-first and shows tiers even before the migration, and "backfills" existing
rows the first time it can write. The `lead_messages` thread, the follow-up
queue, and objection suggestions tolerate the table being absent (empty thread,
no due follow-ups). No new required env. Optional: set the email env (see §5)
to also receive batched hot-signal alerts.

### 2b-vicies. Migration for the buyer-intent gate

The intent-pattern match (e.g. "looking for", "would pay") is a cheap first
pass that still lets through non-buyers — people answering, recommending their
own tool, joking, or venting without seeking a solution. The gate adds a second
pass: Haiku classifies each matched signal as a genuine buyer or not, and the
verdict is cached on the existing `posts` / `post_comments` rows so it's a
one-time cost per item. Run once:

```sql
alter table posts          add column if not exists buyer_intent text check (buyer_intent in ('buyer','not_buyer'));
alter table posts          add column if not exists buyer_intent_at timestamptz;
alter table post_comments  add column if not exists buyer_intent text check (buyer_intent in ('buyer','not_buyer'));
alter table post_comments  add column if not exists buyer_intent_at timestamptz;
create index if not exists posts_buyer_intent_idx         on posts (buyer_intent) where buyer_intent is not null;
create index if not exists post_comments_buyer_intent_idx on post_comments (buyer_intent) where buyer_intent is not null;
```

Null-tolerant + lazy backfill: before the migration the gate reads the missing
column, detects it, and degrades to pass-through (nothing is hidden). After it,
each newly-surfaced signal is classified once (bounded per request), the verdict
is stored, and the Signals feed + Hot-now keep only confirmed buyers (rows not
yet classified pass through until they are). No new env.

### 2b-unvicies. Migration for the relevance gate (on-niche)

Buyer-intent says "this is a real buyer"; relevance says "…and they're a buyer
for *your* niche". The same Haiku pass now also judges whether each signal is
on-niche for the active project (its niche + business profile/memory), so only
on-niche genuine buyers reach Hot-now / Leads. Because relevance depends on the
niche, the verdict is cached together with a `niche_key` and is only trusted
while that key matches the current niche (switch projects / change your profile
→ it re-classifies). Run once:

```sql
alter table posts          add column if not exists on_niche boolean;
alter table posts          add column if not exists niche_key text;
alter table posts          add column if not exists on_niche_at timestamptz;
alter table post_comments  add column if not exists on_niche boolean;
alter table post_comments  add column if not exists niche_key text;
alter table post_comments  add column if not exists on_niche_at timestamptz;
```

Null-tolerant: a missing column → relevance gating is skipped (buyer gate still
applies). When there's no niche yet (no project niche / empty profile),
relevance is not applied at all — nothing is hidden. If `EMBEDDINGS_API_KEY` is
set, an embeddings pre-screen cheaply drops clearly off-niche items before the
Haiku call; otherwise Haiku does the whole judgement. No new required env.

### 2b-duovicies. Migration for the relevance + buyer-intent gate (v2)

The gate is now two clean filters: **buyer-intent** (with explicit
maker/self-promo detection) cached per post, and **relevance** computed against
the *active project* at query time via embedding cosine (so it's never a single
global value baked onto a post). It also lets you **disqualify** a lead with a
reason so off-niche/non-buyer rows disappear from the default views. Run once:

```sql
alter table posts add column if not exists embedding jsonb;        -- if not already present
alter table posts          add column if not exists buyer_intent_type text;
alter table post_comments  add column if not exists buyer_intent_type text;
alter table leads add column if not exists disqualified boolean not null default false;
alter table leads add column if not exists disq_reason text;
create index if not exists leads_disqualified_idx on leads (disqualified);
```

Null-tolerant + additive:
- `posts.embedding` caches each post's embedding vector (computed lazily when
  `EMBEDDINGS_API_KEY` is set); with no key, relevance falls back to a cheap
  Haiku yes/no, and a missing column just means no caching.
- `posts.buyer_intent_type` / `post_comments.buyer_intent_type` cache the
  classifier's intent (looking-for/switching/willing-to-pay) so the badge shows
  the model's judgement rather than the raw matched substring; a missing column
  just falls back to the substring.
- `leads.disqualified` / `disq_reason` default to keeping every existing row; the
  one-off purge ([POST /api/leads/purge](app/api/leads/purge/route.ts)) flags
  off-niche/non-buyer leads so they drop out of the board without being deleted.
- The earlier `on_niche` columns (§2b-unvicies) are now unused but harmless —
  relevance is computed at query time, not cached on the post.

Optional env:
- `HOT_NOW_WINDOW_HOURS` (default `6`) tightens the Hot-now window.
- `RELEVANCE_TAU` (default `0.6`) is the qualifying relevance threshold τ — a
  candidate reaches Hot-now / leads only if its relevance score is `>= τ`.

### 2c. Get the credentials

1. Left sidebar → **Settings** → **API**.
2. Copy the **Project URL** — paste into `.env.local` as `SUPABASE_URL`.
3. Under **Project API keys**, find the **`service_role`** key (NOT the `anon`
   key — they are different). Reveal it, copy it, paste into `.env.local` as
   `SUPABASE_SERVICE_ROLE_KEY`.

> **The service_role key is admin-level and bypasses Row Level Security.**
> It is read only by [lib/supabase.ts](lib/supabase.ts), which has
> `import 'server-only'` at the top — Next.js will refuse to build if any
> client component ever tries to import it. The key never reaches the browser.
> Do not commit `.env.local` (`.env*` is already gitignored).

### 2d. Google sign-in (auth)

The app gates access behind Google sign-in (Supabase Auth). The browser/server
auth clients use the **public** URL + **anon** key (separate from the
service-role key above):

```
NEXT_PUBLIC_SUPABASE_URL=<same Project URL>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<the anon/public key from Settings → API>
```

Then, in the Supabase dashboard:

1. **Authentication → Providers → Google** — enable it and paste your Google
   OAuth **Client ID + Secret** (create them in Google Cloud Console; authorized
   redirect URI = `https://<your-project>.supabase.co/auth/v1/callback`).
2. **Authentication → URL Configuration** — add your app origin(s) (e.g.
   `http://localhost:3000` and your prod URL) to **Redirect URLs**.

Tolerant by design: if the `NEXT_PUBLIC_*` vars are absent the proxy **does not
gate** (the app runs unauthenticated, as before), so existing setups keep
working until you opt in. Public routes (no login): `/login`, `/auth/callback`,
and the marketing/demo site `/site`.

---

## 3. Restart the server

Environment variables are read at process start. After editing `.env.local`:

```
npm run dev
```

Or, if you're launching via the exe wrapper, rebuild it with:

```
npm run build:exe
```

This runs `next build`, stages `public/`, `.next/static/`, and `.env.local` into
`.next/standalone/`, then regenerates `reddit-reader.exe` (Node SEA + postject).
The `.next/standalone/` directory must stay next to the exe. Source edits are
**not** picked up by the exe until you re-run `build:exe`.

---

## 4. Verify it works

1. Open http://localhost:3000 (or 3001 if something else is on 3000).
2. Browse to a subreddit, e.g. `r/saas`.
3. **First visit** to a subreddit: takes a few seconds (50 parallel Claude
   calls). Posts appear grouped under **Pain Points**, **Feature Requests**,
   **Tool Complaints**, **Other**.
4. **Subsequent visits** to the same subreddit: nearly instant — already-seen
   posts come straight from Supabase with their saved category. Only new
   Reddit posts hit Claude.
5. Confirm rows are accumulating: Supabase dashboard → **Table Editor** →
   `posts`.

---

## 5. Scheduling (Phase 6 — autonomy)

The scheduled job keeps data fresh and produces the weekly **State of your
market** digest. It's a single endpoint:

```
POST /api/cron/run
Body (all optional):
  { "subreddits": ["SaaS"], "hackernews": ["dunning"], "stackoverflow": ["stripe webhooks"], "tier": "balanced" }
```

It ingests the configured sources, recomputes snapshots, re-materializes the
Advantage-ranked opportunities, re-synthesizes insights, builds + stores a
digest, and (optionally) emails it. Every step is best-effort.

**Protect it.** Set a secret in `.env.local`:

```
CRON_SECRET=some-long-random-string
```

When set, callers must pass `Authorization: Bearer <CRON_SECRET>` (or
`?key=<CRON_SECRET>`). Unset = open (fine for localhost only).

**Wire a trigger** (pick one):

- **Vercel Cron** — add to `vercel.json` and set `CRON_SECRET` in project env
  (Vercel automatically sends the `Authorization: Bearer` header for cron):

  ```json
  { "crons": [{ "path": "/api/cron/run", "schedule": "0 13 * * 1" }] }
  ```

  (Mondays 13:00 UTC. Vercel cron sends GET by default — this route is POST;
  use an external scheduler if you need POST, or add a GET handler. See note.)

- **External scheduler** (cron-job.org, GitHub Actions, your own cron):

  ```
  curl -X POST https://YOUR_HOST/api/cron/run \
    -H "Authorization: Bearer $CRON_SECRET" \
    -H "content-type: application/json" \
    -d '{"subreddits":["SaaS","startups"]}'
  ```

- **Manual** — hit `POST /api/digest/run` from the **Digest** page's
  "Generate now" button anytime (builds the digest from current data without
  scanning).

**Optional email** of the digest — set these and the cron run will email it:

```
RESEND_API_KEY=re_...          # https://resend.com
DIGEST_EMAIL_TO=you@example.com
DIGEST_EMAIL_FROM=RedditRadar <onboarding@resend.dev>   # optional
```

Leave them unset and email is skipped silently.

> Note: Vercel Cron issues GET requests. This route is POST so it can carry a
> source config + stay auth-gated; trigger it from an external scheduler that
> can POST, or add a thin GET wrapper if you specifically want Vercel Cron.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Supabase is not configured` | `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` still contain `REPLACE_WITH_YOUR_...`. Edit `.env.local` and restart the server. |
| `Anthropic is not configured` | `ANTHROPIC_API_KEY` still contains the placeholder. Same fix. |
| `Database query failed — confirm the posts table exists` | Step 2b didn't run, or it ran against the wrong project. Re-check the URL in `.env.local`. |
| Categories all show as **Other** | A Claude call failed for each post; the classifier falls back to `other` on error. Check the dev-server console for `[claude] classifyPost error:` lines (usually an invalid API key or expired credit). |
| Posts show but no grouping | Hard-refresh the browser — the client component changed. |
