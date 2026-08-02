-- ============================================================================
-- 003_tool_usage_config.sql
-- ----------------------------------------------------------------------------
-- Admin-editable mapping of in-app tools -> GA4 event-name substring patterns,
-- powering the App Performance "Tool Usage" section. Marketing can add/edit
-- tools + patterns without a deploy. `patterns` is a comma-separated list of
-- UPPERCASE substrings; matching is first-match-wins by sort_order.
--
-- Additive + reversible: creates one small config table and seeds the 9 known
-- tools (ON CONFLICT DO NOTHING so re-running never clobbers edits). No
-- existing data is touched. Apply in the Supabase SQL editor.
-- ============================================================================

create table if not exists public.tool_usage_config (
  id          uuid primary key default gen_random_uuid(),
  tool        text not null unique,
  patterns    text not null,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.tool_usage_config is
  'Admin config: maps an in-app tool (display label) to comma-separated '
  'UPPERCASE event_name substrings used to attribute ga_events to that tool on '
  'the App Performance Tool Usage section. First-match-wins by sort_order.';

create index if not exists idx_tool_usage_config_active
  on public.tool_usage_config (is_active) where is_active = true;

-- Reuse the shared updated_at trigger function from migration 001.
drop trigger if exists trg_tool_usage_config_set_updated_at on public.tool_usage_config;
create trigger trg_tool_usage_config_set_updated_at
  before update on public.tool_usage_config
  for each row
  execute function public.set_updated_at();

alter table public.tool_usage_config enable row level security;

-- Seed the 9 tools with verified all-platform patterns (from a 90-day event
-- taxonomy discovery). Note: 'MRHB Store' uses MRHB_STORE (the store product);
-- the broader 'APPS_STORE' apps-hub is intentionally separate — add it here if
-- you want hub traffic counted toward the store.
insert into public.tool_usage_config (tool, patterns, sort_order, is_active) values
  ('MIRO', 'MIRO', 1, true),
  ('Halalytix', 'HALALYTIX', 2, true),
  ('EMPLIFAI', 'EMPLIFAI', 3, true),
  ('Sahal Give', 'SAHAL_GIVE', 4, true),
  ('MRHB Store', 'MRHB_STORE', 5, true),
  ('Sahal Stake', 'SAHAL_STAKE', 6, true),
  ('eSIM', 'ESIM', 7, true),
  ('TijarX', 'TIJARX', 8, true),
  ('Zakat Calculator', 'ZAKAT', 9, true)
on conflict (tool) do nothing;
