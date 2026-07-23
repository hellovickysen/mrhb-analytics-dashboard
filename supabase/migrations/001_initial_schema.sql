-- ============================================================================
-- MRHB Network Analytics Dashboard — Initial Schema
-- ============================================================================
-- Migration: 001_initial_schema.sql
--
-- Purpose:
--   Establishes the full data model for the MRHB Network analytics dashboard.
--   Aggregates daily metrics ingested from five external data sources:
--     1. Google Analytics 4 (GA4)          -> ga_traffic, ga_pages, ga_events, ga_geo
--     2. Google Search Console (GSC)       -> gsc_queries, gsc_pages
--     3. Google Play Console                -> play_installs, play_ratings, play_store_listing
--     4. Short.io (link shortener)          -> shortio_links, shortio_clicks
--     5. Microsoft Clarity                  -> clarity_sessions, clarity_friction
--
--   Plus cross-source rollups (daily_kpis), business/product tables
--   (funnel_stages, transactions, revenue), an admin config table
--   (tracked_events), and an ingestion audit log (data_sync_log).
--
-- Conventions:
--   - Every table has a `uuid` primary key (`id`) generated via gen_random_uuid(),
--     except where the source system's natural key is a better fit (none here —
--     all tables use a surrogate uuid PK; natural keys are enforced via UNIQUE).
--   - Every table has `created_at timestamptz default now()`.
--   - Daily/dimensional tables carry a composite UNIQUE constraint on
--     (date + relevant dimensions) so upstream sync jobs can UPSERT
--     (`ON CONFLICT ... DO UPDATE`) without creating duplicate rows.
--   - `date` columns use `date` (not `timestamptz`) since all source APIs
--     report metrics at daily granularity.
--   - Row Level Security (RLS) is enabled on every table. No policies are
--     defined yet — the application owner will add policies once auth
--     (e.g. Supabase Auth roles) is wired up. Until policies exist, only
--     the `service_role` key can read/write these tables (RLS default-denies
--     for all other roles).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- Extensions
-- ----------------------------------------------------------------------------
-- gen_random_uuid() lives in pgcrypto on older Postgres; on Supabase's
-- Postgres builds it's also natively available, but we create the extension
-- defensively so this migration is portable across environments.
create extension if not exists "pgcrypto";


-- ----------------------------------------------------------------------------
-- Enum types
-- ----------------------------------------------------------------------------

-- Identifies which of the 5 upstream integrations a row of `daily_kpis`
-- (or a sync log entry) originated from.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'analytics_source') then
    create type analytics_source as enum ('ga4', 'gsc', 'play', 'shortio', 'clarity');
  end if;
end $$;

-- Classification for the admin-configurable event tracking table.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'tracked_event_category') then
    create type tracked_event_category as enum ('transaction', 'engagement', 'conversion', 'custom');
  end if;
end $$;

-- Lifecycle status for a single ingestion run, written to data_sync_log.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'sync_status') then
    create type sync_status as enum ('running', 'success', 'error');
  end if;
end $$;


-- ============================================================================
-- 1. daily_kpis — cross-source daily rollup, one row per (date, source, metric)
-- ============================================================================
create table if not exists public.daily_kpis (
  id                     uuid primary key default gen_random_uuid(),
  date                   date not null,
  source                 analytics_source not null,
  metric_name            text not null,
  metric_value           numeric not null,
  period_comparison_pct  numeric,
  created_at             timestamptz not null default now(),

  -- One value per metric, per source, per day — enables upsert-on-sync.
  constraint daily_kpis_date_source_metric_key
    unique (date, source, metric_name)
);

comment on table public.daily_kpis is
  'Cross-source daily KPI rollup. One row per (date, source, metric_name) pair; '
  'the canonical table for headline dashboard tiles and trend lines that blend '
  'metrics across GA4, GSC, Play Console, Short.io, and Clarity. '
  'period_comparison_pct holds the % change vs. the prior comparable period '
  '(e.g. prior day/week/month, as computed by the sync job), and is null until '
  'enough history exists to compute a comparison.';

create index if not exists idx_daily_kpis_date on public.daily_kpis (date);
create index if not exists idx_daily_kpis_source on public.daily_kpis (source);
create index if not exists idx_daily_kpis_metric_name on public.daily_kpis (metric_name);
create index if not exists idx_daily_kpis_source_metric_date on public.daily_kpis (source, metric_name, date);

alter table public.daily_kpis enable row level security;


-- ============================================================================
-- 2. ga_traffic — GA4 daily traffic broken down by acquisition channel
-- ============================================================================
create table if not exists public.ga_traffic (
  id                     uuid primary key default gen_random_uuid(),
  date                   date not null,
  sessions               integer not null default 0,
  users                  integer not null default 0,
  new_users              integer not null default 0,
  pageviews              integer not null default 0,
  bounce_rate            numeric not null default 0,
  avg_session_duration   numeric not null default 0,
  channel                text not null,
  source                 text not null,
  medium                 text not null,
  campaign               text,
  created_at             timestamptz not null default now(),

  -- A given day's traffic is broken out by channel/source/medium/campaign;
  -- re-syncing the same slice should update in place, not duplicate.
  constraint ga_traffic_date_channel_source_medium_campaign_key
    unique (date, channel, source, medium, campaign)
);

comment on table public.ga_traffic is
  'Google Analytics 4 daily traffic, broken down by acquisition dimensions '
  '(default channel grouping, source, medium, and optional campaign). '
  'Powers acquisition/traffic-source views on the dashboard.';

create index if not exists idx_ga_traffic_date on public.ga_traffic (date);
create index if not exists idx_ga_traffic_channel on public.ga_traffic (channel);
create index if not exists idx_ga_traffic_source_medium on public.ga_traffic (source, medium);
create index if not exists idx_ga_traffic_campaign on public.ga_traffic (campaign) where campaign is not null;


-- ============================================================================
-- 3. ga_pages — GA4 daily page-level performance
-- ============================================================================
create table if not exists public.ga_pages (
  id                   uuid primary key default gen_random_uuid(),
  date                 date not null,
  page_path            text not null,
  page_title           text not null,
  pageviews            integer not null default 0,
  avg_time_on_page     numeric not null default 0,
  exit_rate            numeric not null default 0,
  entrances            integer not null default 0,
  created_at           timestamptz not null default now(),

  constraint ga_pages_date_page_path_key
    unique (date, page_path)
);

comment on table public.ga_pages is
  'Google Analytics 4 daily page-level performance (pageviews, engagement, '
  'exit/entrance behavior). One row per (date, page_path). Powers top-pages '
  'and content-performance views.';

create index if not exists idx_ga_pages_date on public.ga_pages (date);
create index if not exists idx_ga_pages_page_path on public.ga_pages (page_path);
create index if not exists idx_ga_pages_pageviews on public.ga_pages (pageviews desc);


-- ============================================================================
-- 4. ga_events — GA4 daily event counts
-- ============================================================================
create table if not exists public.ga_events (
  id             uuid primary key default gen_random_uuid(),
  date           date not null,
  event_name     text not null,
  event_count    integer not null default 0,
  users          integer not null default 0,
  event_value    numeric,
  is_conversion  boolean not null default false,
  created_at     timestamptz not null default now(),

  constraint ga_events_date_event_name_key
    unique (date, event_name)
);

comment on table public.ga_events is
  'Google Analytics 4 daily event tracking (custom events, conversions, etc.). '
  'One row per (date, event_name). is_conversion flags events that GA4 marks '
  '(or the dashboard admin marks via tracked_events) as conversion events. '
  'event_value is nullable since not all events carry a monetary/numeric value.';

create index if not exists idx_ga_events_date on public.ga_events (date);
create index if not exists idx_ga_events_event_name on public.ga_events (event_name);
create index if not exists idx_ga_events_is_conversion on public.ga_events (is_conversion) where is_conversion = true;


-- ============================================================================
-- 5. ga_geo — GA4 daily geo + device breakdown
-- ============================================================================
create table if not exists public.ga_geo (
  id               uuid primary key default gen_random_uuid(),
  date             date not null,
  country          text not null,
  city             text,
  users            integer not null default 0,
  sessions         integer not null default 0,
  device_category  text not null,
  browser          text,
  os               text,
  created_at       timestamptz not null default now(),

  -- Geo/device slices can legitimately repeat city=NULL for country-level
  -- rows, so city/browser/os participate in the uniqueness key with NULLS
  -- being distinct per standard SQL NULL semantics (acceptable here since
  -- the sync job always writes a consistent granularity per row shape).
  constraint ga_geo_date_country_city_device_browser_os_key
    unique (date, country, city, device_category, browser, os)
);

comment on table public.ga_geo is
  'Google Analytics 4 daily audience breakdown by geography (country/city) and '
  'device (category/browser/OS). One row per unique dimension combination per day. '
  'Powers geo maps and device/browser breakdown widgets.';

create index if not exists idx_ga_geo_date on public.ga_geo (date);
create index if not exists idx_ga_geo_country on public.ga_geo (country);
create index if not exists idx_ga_geo_device_category on public.ga_geo (device_category);


-- ============================================================================
-- 6. gsc_queries — Search Console daily query performance
-- ============================================================================
create table if not exists public.gsc_queries (
  id           uuid primary key default gen_random_uuid(),
  date         date not null,
  query        text not null,
  page         text not null,
  impressions  integer not null default 0,
  clicks       integer not null default 0,
  ctr          numeric not null default 0,
  position     numeric not null default 0,
  created_at   timestamptz not null default now(),

  constraint gsc_queries_date_query_page_key
    unique (date, query, page)
);

comment on table public.gsc_queries is
  'Google Search Console daily search performance by (query, landing page). '
  'One row per unique query/page pair per day. Powers keyword-performance and '
  'query-to-page mapping views.';

create index if not exists idx_gsc_queries_date on public.gsc_queries (date);
create index if not exists idx_gsc_queries_query on public.gsc_queries (query);
create index if not exists idx_gsc_queries_page on public.gsc_queries (page);
create index if not exists idx_gsc_queries_clicks on public.gsc_queries (clicks desc);


-- ============================================================================
-- 7. gsc_pages — Search Console daily page performance
-- ============================================================================
create table if not exists public.gsc_pages (
  id           uuid primary key default gen_random_uuid(),
  date         date not null,
  page         text not null,
  impressions  integer not null default 0,
  clicks       integer not null default 0,
  ctr          numeric not null default 0,
  position     numeric not null default 0,
  created_at   timestamptz not null default now(),

  constraint gsc_pages_date_page_key
    unique (date, page)
);

comment on table public.gsc_pages is
  'Google Search Console daily search performance aggregated by landing page '
  '(no query breakdown). One row per (date, page). Powers top-organic-pages views.';

create index if not exists idx_gsc_pages_date on public.gsc_pages (date);
create index if not exists idx_gsc_pages_page on public.gsc_pages (page);
create index if not exists idx_gsc_pages_clicks on public.gsc_pages (clicks desc);


-- ============================================================================
-- 8. play_installs — Google Play Console daily install/uninstall stats
-- ============================================================================
create table if not exists public.play_installs (
  id                uuid primary key default gen_random_uuid(),
  date              date not null,
  installs          integer not null default 0,
  uninstalls        integer not null default 0,
  active_devices    integer not null default 0,
  update_installs   integer not null default 0,
  country           text not null default 'ALL',
  created_at        timestamptz not null default now(),

  constraint play_installs_date_country_key
    unique (date, country)
);

comment on table public.play_installs is
  'Google Play Console daily install/uninstall/active-device counts. '
  'country defaults to ''ALL'' for the worldwide aggregate row; per-country '
  'breakdown rows use the ISO country code. update_installs tracks installs '
  'that are app updates rather than new installs.';

create index if not exists idx_play_installs_date on public.play_installs (date);
create index if not exists idx_play_installs_country on public.play_installs (country);


-- ============================================================================
-- 9. play_ratings — Google Play Console daily rating distribution
-- ============================================================================
create table if not exists public.play_ratings (
  id             uuid primary key default gen_random_uuid(),
  date           date not null,
  avg_rating     numeric not null default 0,
  total_ratings  integer not null default 0,
  star_1         integer not null default 0,
  star_2         integer not null default 0,
  star_3         integer not null default 0,
  star_4         integer not null default 0,
  star_5         integer not null default 0,
  reviews_count  integer not null default 0,
  created_at     timestamptz not null default now(),

  constraint play_ratings_date_key
    unique (date)
);

comment on table public.play_ratings is
  'Google Play Console daily app rating snapshot: overall average rating, '
  'total rating count, the 1-5 star distribution, and count of written reviews. '
  'One row per day (ratings are reported as a running worldwide total by Play Console).';

create index if not exists idx_play_ratings_date on public.play_ratings (date);


-- ============================================================================
-- 10. play_store_listing — Google Play Console daily store listing funnel
-- ============================================================================
create table if not exists public.play_store_listing (
  id                        uuid primary key default gen_random_uuid(),
  date                      date not null,
  impressions               integer not null default 0,
  visits                    integer not null default 0,
  installs                  integer not null default 0,
  install_conversion_rate   numeric not null default 0,
  country                   text not null default 'ALL',
  created_at                timestamptz not null default now(),

  constraint play_store_listing_date_country_key
    unique (date, country)
);

comment on table public.play_store_listing is
  'Google Play Console daily store-listing funnel: impressions -> visits -> installs, '
  'plus the derived install_conversion_rate. country defaults to ''ALL'' for the '
  'worldwide aggregate row. Powers the store-listing conversion-funnel widget.';

create index if not exists idx_play_store_listing_date on public.play_store_listing (date);
create index if not exists idx_play_store_listing_country on public.play_store_listing (country);


-- ============================================================================
-- 11. shortio_links — Short.io link registry (dimension table, not daily facts)
-- ============================================================================
create table if not exists public.shortio_links (
  id           uuid primary key default gen_random_uuid(),
  link_id      text not null,
  short_url    text not null,
  original_url text not null,
  title        text,
  utm_source   text,
  utm_medium   text,
  utm_campaign text,
  created_at   timestamptz not null default now(),

  constraint shortio_links_link_id_key
    unique (link_id)
);

comment on table public.shortio_links is
  'Short.io link registry — one row per shortened link ever created. This is a '
  'dimension/reference table (not a daily fact table): link_id is Short.io''s '
  'immutable identifier and is referenced by shortio_clicks.link_id as the join key.';

-- link_id already has a unique index from the constraint above; add a
-- secondary index for lookups/joins on the natural key column name pattern
-- used elsewhere, plus common filter columns.
create index if not exists idx_shortio_links_utm_campaign on public.shortio_links (utm_campaign) where utm_campaign is not null;
create index if not exists idx_shortio_links_created_at on public.shortio_links (created_at);

alter table public.shortio_links enable row level security;


-- ============================================================================
-- 12. shortio_clicks — Short.io daily click stats per link
-- ============================================================================
create table if not exists public.shortio_clicks (
  id            uuid primary key default gen_random_uuid(),
  date          date not null,
  link_id       text not null references public.shortio_links (link_id) on delete cascade,
  total_clicks  integer not null default 0,
  human_clicks  integer not null default 0,
  country       text,
  city          text,
  os            text,
  browser       text,
  referrer      text,
  created_at    timestamptz not null default now(),

  -- Clicks are broken out per link, per day, per geo/device/referrer slice.
  -- NULL dimension columns are treated as their own "no breakdown" bucket by
  -- Postgres unique-index NULL semantics, which matches how the sync job
  -- writes country-level totals (all dimension columns NULL) alongside
  -- detailed breakdown rows.
  constraint shortio_clicks_date_link_country_city_os_browser_referrer_key
    unique (date, link_id, country, city, os, browser, referrer)
);

comment on table public.shortio_clicks is
  'Short.io daily click analytics per short link, optionally broken down by '
  'country/city/OS/browser/referrer. link_id references shortio_links.link_id. '
  'human_clicks excludes bot/crawler traffic that total_clicks includes.';

create index if not exists idx_shortio_clicks_date on public.shortio_clicks (date);
create index if not exists idx_shortio_clicks_link_id on public.shortio_clicks (link_id);
create index if not exists idx_shortio_clicks_country on public.shortio_clicks (country) where country is not null;
create index if not exists idx_shortio_clicks_link_date on public.shortio_clicks (link_id, date);

alter table public.shortio_clicks enable row level security;


-- ============================================================================
-- 13. clarity_sessions — Microsoft Clarity daily session-quality metrics
-- ============================================================================
create table if not exists public.clarity_sessions (
  id                      uuid primary key default gen_random_uuid(),
  date                    date not null,
  sessions                integer not null default 0,
  bot_sessions_excluded   integer not null default 0,
  pages_per_session       numeric not null default 0,
  scroll_depth_pct        numeric not null default 0,
  active_time_sec         numeric not null default 0,
  total_time_sec          numeric not null default 0,
  unique_users            integer not null default 0,
  new_user_pct            numeric not null default 0,
  created_at              timestamptz not null default now(),

  constraint clarity_sessions_date_key
    unique (date)
);

comment on table public.clarity_sessions is
  'Microsoft Clarity daily session-quality summary: volume, engagement depth '
  '(pages/session, scroll depth), and time-on-site metrics. One row per day '
  '(Clarity reports these as site-wide daily aggregates, no dimension breakdown).';

create index if not exists idx_clarity_sessions_date on public.clarity_sessions (date);


-- ============================================================================
-- 14. clarity_friction — Microsoft Clarity daily UX friction signals
-- ============================================================================
create table if not exists public.clarity_friction (
  id                             uuid primary key default gen_random_uuid(),
  date                           date not null,
  page_url                       text not null default 'ALL',
  rage_clicks_pct                numeric not null default 0,
  rage_clicks_sessions           integer not null default 0,
  dead_clicks_pct                numeric not null default 0,
  dead_clicks_sessions           integer not null default 0,
  excessive_scrolling_pct        numeric not null default 0,
  excessive_scrolling_sessions   integer not null default 0,
  quick_backs_pct                numeric not null default 0,
  quick_backs_sessions           integer not null default 0,
  created_at                     timestamptz not null default now(),

  constraint clarity_friction_date_page_url_key
    unique (date, page_url)
);

comment on table public.clarity_friction is
  'Microsoft Clarity daily UX friction signals (rage clicks, dead clicks, '
  'excessive scrolling, quick backs) — both the % of sessions affected and the '
  'raw session counts. page_url defaults to ''ALL'' for the site-wide aggregate '
  'row; specific URLs get their own row when Clarity reports page-level friction.';

create index if not exists idx_clarity_friction_date on public.clarity_friction (date);
create index if not exists idx_clarity_friction_page_url on public.clarity_friction (page_url);


-- ============================================================================
-- 15. funnel_stages — product/marketing funnel definition + daily performance
-- ============================================================================
create table if not exists public.funnel_stages (
  id                uuid primary key default gen_random_uuid(),
  date              date not null,
  stage_name        text not null,
  stage_order       integer not null,
  users_entered     integer not null default 0,
  users_exited      integer not null default 0,
  conversion_rate   numeric not null default 0,
  drop_off_rate     numeric not null default 0,
  created_at        timestamptz not null default now(),

  -- stage_order is included in the key (not just stage_name) so the funnel's
  -- ordering is authoritative and re-syncs can't accidentally collide two
  -- differently-ordered stages that happen to share a name across funnel
  -- revisions.
  constraint funnel_stages_date_stage_name_stage_order_key
    unique (date, stage_name, stage_order)
);

comment on table public.funnel_stages is
  'Daily snapshot of a defined multi-step funnel (e.g. visit -> signup -> '
  'activation -> purchase). stage_order fixes display/analysis order. Powers '
  'the funnel visualization widget on the dashboard. This table is populated '
  'by whatever business logic computes the funnel (not a raw external source).';

create index if not exists idx_funnel_stages_date on public.funnel_stages (date);
create index if not exists idx_funnel_stages_stage_name on public.funnel_stages (stage_name);
create index if not exists idx_funnel_stages_date_order on public.funnel_stages (date, stage_order);


-- ============================================================================
-- 16. transactions — daily transaction rollups by type/product
-- ============================================================================
create table if not exists public.transactions (
  id                uuid primary key default gen_random_uuid(),
  date              date not null,
  transaction_type  text not null,
  count             integer not null default 0,
  total_value       numeric not null default 0,
  currency          text not null default 'USD',
  product           text not null,
  created_at        timestamptz not null default now(),

  constraint transactions_date_type_currency_product_key
    unique (date, transaction_type, currency, product)
);

comment on table public.transactions is
  'Daily transaction rollup broken down by transaction_type (e.g. purchase, '
  'refund, subscription), currency, and product. Aggregated counts/values, not '
  'individual transaction records — powers revenue/commerce widgets on the '
  'dashboard alongside the revenue table.';

create index if not exists idx_transactions_date on public.transactions (date);
create index if not exists idx_transactions_type on public.transactions (transaction_type);
create index if not exists idx_transactions_product on public.transactions (product);
create index if not exists idx_transactions_currency on public.transactions (currency);


-- ============================================================================
-- 17. revenue — daily revenue rollups by source
-- ============================================================================
create table if not exists public.revenue (
  id                  uuid primary key default gen_random_uuid(),
  date                date not null,
  source              text not null,
  amount              numeric not null default 0,
  currency            text not null default 'USD',
  transaction_count   integer not null default 0,
  created_at          timestamptz not null default now(),

  constraint revenue_date_source_currency_key
    unique (date, source, currency)
);

comment on table public.revenue is
  'Daily revenue rollup broken down by source (e.g. app store, web checkout, '
  'subscription platform) and currency. source here is a free-text business '
  'revenue channel, distinct from the analytics_source enum used in daily_kpis.';

create index if not exists idx_revenue_date on public.revenue (date);
create index if not exists idx_revenue_source on public.revenue (source);
create index if not exists idx_revenue_currency on public.revenue (currency);


-- ============================================================================
-- 18. tracked_events — admin panel config for which events matter
-- ============================================================================
create table if not exists public.tracked_events (
  id                uuid primary key default gen_random_uuid(),
  event_name        text not null,
  display_name      text not null,
  category          tracked_event_category not null default 'custom',
  is_active         boolean not null default true,
  track_as_revenue  boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint tracked_events_event_name_key
    unique (event_name)
);

comment on table public.tracked_events is
  'Admin-panel configuration table: defines which raw source events (matched '
  'by event_name, typically joining against ga_events.event_name) should be '
  'surfaced on the dashboard, how they should be labeled/categorized, whether '
  'they are currently active, and whether they should be counted toward '
  'revenue rollups. This is a config table, not a fact table — small row count, '
  'edited via the admin UI rather than synced from an external source.';

create index if not exists idx_tracked_events_category on public.tracked_events (category);
create index if not exists idx_tracked_events_is_active on public.tracked_events (is_active) where is_active = true;

-- Keep updated_at current on every row change.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_tracked_events_set_updated_at on public.tracked_events;
create trigger trg_tracked_events_set_updated_at
  before update on public.tracked_events
  for each row
  execute function public.set_updated_at();


-- ============================================================================
-- 19. data_sync_log — ingestion run audit log
-- ============================================================================
create table if not exists public.data_sync_log (
  id               uuid primary key default gen_random_uuid(),
  source           text not null,
  started_at       timestamptz not null default now(),
  completed_at     timestamptz,
  status           sync_status not null default 'running',
  records_synced   integer not null default 0,
  error_message    text,
  created_at       timestamptz not null default now()
);

comment on table public.data_sync_log is
  'Audit log of data ingestion runs across all 5 integrations. Each row tracks '
  'one sync attempt: when it started/completed, whether it succeeded, how many '
  'records it wrote, and (on failure) the error detail. source is free-text '
  '(e.g. ''ga4'', ''gsc'', ''play'', ''shortio'', ''clarity'') rather than the '
  'analytics_source enum, so the log can also capture sync jobs for sources '
  'added later without a migration. No unique constraint — a source can have '
  'many sync runs, including concurrent/retried ones.';

create index if not exists idx_data_sync_log_source on public.data_sync_log (source);
create index if not exists idx_data_sync_log_started_at on public.data_sync_log (started_at desc);
create index if not exists idx_data_sync_log_status on public.data_sync_log (status);
create index if not exists idx_data_sync_log_source_started_at on public.data_sync_log (source, started_at desc);


-- ============================================================================
-- Row Level Security
-- ============================================================================
-- Enabled on every table with NO policies defined yet. Per Postgres/Supabase
-- RLS semantics, enabling RLS without any policy makes the table
-- inaccessible to all roles except the table owner and `service_role`
-- (which bypasses RLS entirely). This is intentional: it keeps these tables
-- safely locked down for anon/authenticated clients until the app owner
-- defines real policies once auth is configured.
-- ----------------------------------------------------------------------------
alter table public.ga_traffic            enable row level security;
alter table public.ga_pages              enable row level security;
alter table public.ga_events             enable row level security;
alter table public.ga_geo                enable row level security;
alter table public.gsc_queries           enable row level security;
alter table public.gsc_pages             enable row level security;
alter table public.play_installs         enable row level security;
alter table public.play_ratings          enable row level security;
alter table public.play_store_listing    enable row level security;
alter table public.clarity_sessions      enable row level security;
alter table public.clarity_friction      enable row level security;
alter table public.funnel_stages         enable row level security;
alter table public.transactions          enable row level security;
alter table public.revenue               enable row level security;
alter table public.tracked_events        enable row level security;
alter table public.data_sync_log         enable row level security;

-- Note: daily_kpis, shortio_links, and shortio_clicks already had RLS
-- enabled inline immediately after their CREATE TABLE statements above;
-- listed here again only in the comment for completeness of the audit trail.


-- ============================================================================
-- End of migration 001_initial_schema.sql
-- ============================================================================
