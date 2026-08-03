-- ============================================================================
-- 004_app_metric_map.sql
-- ----------------------------------------------------------------------------
-- Admin-editable mapping of App Performance metric "blocks" -> GA4 event-name
-- patterns. The App Performance KPIs, onboarding funnel, and trend are all
-- computed from these blocks, so editing a block's patterns here changes every
-- card derived from it (e.g. renaming the onboarding-complete event updates the
-- Onboarding Rate KPI and the funnel stage together).
--
-- `patterns` is a comma-separated list of UPPERCASE event_name substrings.
-- `match_type` is 'exact' (event_name equals a pattern) or 'contains' (pattern
-- is a substring — used for cross-platform families like *_APP_DASHBOARD).
--
-- Additive + reversible; seeds the 6 known blocks (ON CONFLICT DO NOTHING). No
-- existing data touched. Apply in the Supabase SQL editor. Until applied, the
-- app falls back to the built-in DEFAULT_APP_METRICS.
-- ============================================================================

create table if not exists public.app_metric_map (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,
  label       text not null,
  patterns    text not null,
  match_type  text not null default 'contains',
  description text not null default '',
  used_by     text not null default '',
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.app_metric_map is
  'Admin config: App Performance metric blocks -> GA4 event_name patterns '
  '(comma-separated UPPERCASE substrings; match_type exact|contains). Editing '
  'a block re-computes every App Performance card derived from it.';

create index if not exists idx_app_metric_map_active
  on public.app_metric_map (is_active) where is_active = true;

drop trigger if exists trg_app_metric_map_set_updated_at on public.app_metric_map;
create trigger trg_app_metric_map_set_updated_at
  before update on public.app_metric_map
  for each row
  execute function public.set_updated_at();

alter table public.app_metric_map enable row level security;

insert into public.app_metric_map (key, label, patterns, match_type, description, used_by, sort_order, is_active) values
  ('first_open', 'App Opens (installs proxy)', 'FIRST_OPEN', 'exact',
   'Firebase first_open — fires once per device on first launch after install.',
   'Total Installs (proxy), Onboarding Rate denominator, Funnel: App Opened, Installs trend', 1, true),
  ('session_start', 'App Sessions', 'SESSION_START', 'exact',
   'Firebase session_start — an app session began.',
   'Active Users (fallback), Active-users trend', 2, true),
  ('get_started', 'Get Started', 'GET_STARTED', 'contains',
   'Any Get Started screen across platforms.', 'Funnel: Get Started', 3, true),
  ('onboarding_complete', 'Onboarding Complete', 'ONBOARDING_GUIDE_COMPLETE', 'contains',
   'Guided-onboarding completion event (EA_/EI_/EW_).',
   'Onboarding Rate numerator, Funnel: Onboarding Complete', 4, true),
  ('dashboard', 'Dashboard Reached', 'APP_DASHBOARD', 'contains',
   'Main app dashboard screen reached.',
   'Transaction Rate denominator, Funnel: Reached Dashboard', 5, true),
  ('transaction', 'Transactions', 'SEND_MONEY,_SEND_,SWAP,SAHAL_RAMP', 'contains',
   'Send / swap / ramp transaction events across platforms.',
   'Transaction Rate numerator, Funnel: Transaction', 6, true)
on conflict (key) do nothing;
