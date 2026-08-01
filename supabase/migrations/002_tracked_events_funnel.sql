-- ============================================================================
-- 002_tracked_events_funnel.sql
-- ----------------------------------------------------------------------------
-- Adds funnel-stage configuration to the admin `tracked_events` table so the
-- User Journey funnel's APP-EVENT stages (App Installs / 1st Dashboard /
-- 1st Transaction, and any future sub-stages) are driven by editable config
-- instead of hardcoded event-name rules. Renaming/adding an event in the admin
-- panel then rebuilds the funnel + cards automatically.
--
-- Additive and reversible: it only ADDs two nullable/defaulted columns and an
-- index, and seeds a handful of real app events with ON CONFLICT DO NOTHING so
-- re-running never clobbers admin edits. No existing data is modified.
--
-- Apply in the Supabase SQL editor (the app's service key cannot run DDL).
-- ============================================================================

alter table public.tracked_events
  add column if not exists funnel_stage text,
  add column if not exists stage_order integer not null default 0;

create index if not exists idx_tracked_events_funnel_stage
  on public.tracked_events (funnel_stage);

comment on column public.tracked_events.funnel_stage is
  'Which User Journey funnel stage this event feeds (e.g. App Installs, '
  '1st Dashboard, 1st Transaction). NULL = tracked but not part of the funnel.';
comment on column public.tracked_events.stage_order is
  'Display/sort order of the funnel stage this event belongs to (lower first).';

-- Seed the real Sahal Wallet app events that drive the funnel's app-event
-- stages, mapped to the corresponding stage. ON CONFLICT DO NOTHING keeps this
-- safe to re-run and never overwrites a value an admin has since edited.
insert into public.tracked_events
  (event_name, display_name, category, funnel_stage, stage_order, is_active, track_as_revenue)
values
  ('first_open',       'App install (first open)', 'conversion',  'App Installs',    3, true, false),
  ('SA_APP_DASHBOARD', 'Dashboard (Android)',      'engagement',  '1st Dashboard',   4, true, false),
  ('SI_APP_DASHBOARD', 'Dashboard (iOS)',          'engagement',  '1st Dashboard',   4, true, false),
  ('SW_SEND_MONEY',    'Send money (Web)',         'transaction', '1st Transaction', 5, true, false),
  ('SA_SWAP',          'Swap (Android)',           'transaction', '1st Transaction', 5, true, false),
  ('SA_SAHAL_RAMP',    'Ramp (Android)',           'transaction', '1st Transaction', 5, true, false)
on conflict (event_name) do nothing;
