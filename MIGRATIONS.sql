alter table posts add column if not exists topic text;
create index if not exists posts_topic_idx on posts (topic) where topic is not null;
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
alter table buyer_language add column if not exists messaging jsonb;
alter table posts add column if not exists posted_at timestamptz;
create index if not exists posts_posted_at_idx
  on posts (posted_at desc) where posted_at is not null;
alter table posts add column if not exists canonical_topic text;
create index if not exists posts_canonical_topic_idx
  on posts (canonical_topic) where canonical_topic is not null;
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
create table if not exists knowledge_insights (
  id           bigserial primary key,
  insights     jsonb not null,
  stats        jsonb not null,
  generated_at timestamptz not null default now()
);
create index if not exists knowledge_insights_generated_at_idx
  on knowledge_insights (generated_at desc);
alter table posts add column if not exists confidence text;
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
create table if not exists trend_insights (
  topic        text primary key,
  insight      text not null,
  generated_at timestamptz not null default now()
);
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
create table if not exists digests (
  id bigserial primary key,
  project_id text not null default 'default',
  period text not null,
  brief jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists digests_created_idx on digests (created_at desc);
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
alter table posts          add column if not exists buyer_intent text check (buyer_intent in ('buyer','not_buyer'));
alter table posts          add column if not exists buyer_intent_at timestamptz;
alter table post_comments  add column if not exists buyer_intent text check (buyer_intent in ('buyer','not_buyer'));
alter table post_comments  add column if not exists buyer_intent_at timestamptz;
create index if not exists posts_buyer_intent_idx         on posts (buyer_intent) where buyer_intent is not null;
create index if not exists post_comments_buyer_intent_idx on post_comments (buyer_intent) where buyer_intent is not null;

-- The founder's own replies, pasted in Settings, used as the voice anchor for
-- generated openers/replies. 1–2 are injected per draft. Scoped per workspace.
create table if not exists voice_samples (
  id         bigserial primary key,
  project_id text not null default 'default',
  body       text not null,
  created_at timestamptz not null default now()
);
create index if not exists voice_samples_project_idx
  on voice_samples (project_id, created_at desc);

-- Seed the default workspace with two on-voice samples (serious/direct, varied
-- length) so generation has an anchor out of the box. Only seeds when empty, so
-- it never fights a founder who has pasted their own.
-- Dollar-quoted ($s$…$s$) so apostrophes need no escaping, and with no in-string
-- semicolons — some SQL runners split statements on ';' without honoring string
-- literals, which would chop these mid-sentence.
insert into voice_samples (project_id, body)
select 'default', v.body
from (values
  ($s$The tool isn't the problem - intake is. Email's handled by anything. Phone and text off a personal number is what nothing solves cleanly.$s$),
  ($s$The tool isn't your problem, intake is. Email's solved by anything (shared mailbox + Power Automate, or Halo/Freshservice). What none of them handle cleanly is phone and text off a personal number. Get a dedicated number and force everything into one queue first, then pick the tool. Tool-first is why these rollouts stall. What's your actual call volume?$s$)
) as v(body)
where not exists (select 1 from voice_samples where project_id = 'default');

-- Voice engine: the distilled positioning + angles + copy (one JSONB brief per
-- run), grounded in the buyer_language data. Newest row per project wins.
create table if not exists voice_brief (
  id           bigserial primary key,
  project_id   text not null default 'default',
  brief        jsonb not null,
  model        text not null default '',
  generated_at timestamptz not null default now()
);
create index if not exists voice_brief_project_idx
  on voice_brief (project_id, generated_at desc);

-- Public instant-scan funnel (/api/public/scan): durable per-IP + global daily
-- rate limit. The `__global__` row is a distributed-abuse backstop.
create table if not exists ip_rate_limits (
  ip        text primary key,
  count     int  not null default 0,
  reset_at  timestamptz not null default (now() + interval '1 day')
);

-- Per-workspace usage-credit budget (the gross-margin guard). Cost-bearing
-- routes charge credits (≈ Claude COGS) before spending; over-budget → 402.
create table if not exists project_usage (
  project_id   text primary key,
  credits_used int  not null default 0,
  reset_at     timestamptz not null default (now() + interval '30 days')
);
