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

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Supabase is not configured` | `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` still contain `REPLACE_WITH_YOUR_...`. Edit `.env.local` and restart the server. |
| `Anthropic is not configured` | `ANTHROPIC_API_KEY` still contains the placeholder. Same fix. |
| `Database query failed — confirm the posts table exists` | Step 2b didn't run, or it ran against the wrong project. Re-check the URL in `.env.local`. |
| Categories all show as **Other** | A Claude call failed for each post; the classifier falls back to `other` on error. Check the dev-server console for `[claude] classifyPost error:` lines (usually an invalid API key or expired credit). |
| Posts show but no grouping | Hard-refresh the browser — the client component changed. |
