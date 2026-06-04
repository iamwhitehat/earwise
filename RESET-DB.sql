-- ============================================================
-- earwise — RESET: wipe scanned/derived/lead data, start fresh
-- ============================================================
-- Brise SAMO podatke (scanani posti, signali, leadi, agregati,
-- stanja). OHRANI konfiguracijo: projects, business_profile,
-- business_memory, sources. Schema (tabele) ostane.
--
-- Varno: truncira le tabele, ki obstajajo (to_regclass guard),
-- v enem prehodu, z RESTART IDENTITY (resetira ID-je) + CASCADE.
--
-- ZAŽENI ŠELE PO tem, ko je gate patch (relevance + buyer-intent)
-- implementiran — sicer svež scan reproducira isto smetje.
-- ============================================================

do $$
declare t text;
begin
  foreach t in array array[
    -- raw + classified scrape
    'post_comments', 'posts', 'signals',
    -- leads + conversation + outcomes
    'lead_messages', 'lead_events', 'events', 'leads',
    -- derived / aggregated intelligence
    'opportunities', 'buyer_language', 'knowledge_insights',
    'trend_insights', 'trend_snapshots', 'digests',
    -- redesign state (če obstajajo)
    'opportunity_state', 'triage_state', 'reach_posts',
    'offer_signups', 'offer_tests', 'coachmarks_seen'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('truncate table %I restart identity cascade', t);
      raise notice 'wiped %', t;
    end if;
  end loop;
end $$;

-- OHRANJENO (NE brisano): projects, business_profile,
-- business_memory, sources.
--
-- ── Opcijsko: TOTAL reset (tudi niša/ICP/projekti) ──
-- Odkomentiraj, če želiš začeti popolnoma iz nič:
-- truncate table business_memory restart identity cascade;
-- truncate table business_profile restart identity cascade;
-- -- truncate table projects restart identity cascade;  -- pozor: pobrise workspace-e
