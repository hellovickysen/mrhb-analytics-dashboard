/**
 * MRHB Network Analytics Dashboard — Shared Type Definitions
 *
 * This module is the single source of truth for:
 *   1. Database row types (mirroring Supabase tables)
 *   2. Dashboard component prop types
 *   3. API response envelope types (one per data source)
 *   4. Cross-cutting utility types
 *
 * Conventions:
 *   - Row types use `snake_case` fields to match Postgres/Supabase column names 1:1.
 *   - Component/prop types use `camelCase` per React/TypeScript convention.
 *   - Nullable DB columns are typed as `T | null` (never `T | undefined`), matching
 *     the value Supabase's client returns for SQL NULL.
 *   - Optional (but always-present-in-shape) UI fields use `?:`.
 *   - Timestamps that come back from Supabase as ISO strings are typed `string`,
 *     not `Date`. Convert at the UI boundary when a `Date` is actually needed.
 */

import type { LucideIcon } from 'lucide-react';

/* ------------------------------------------------------------------------ */
/*  1. DATABASE ROW TYPES                                                    */
/* ------------------------------------------------------------------------ */

/**
 * Aggregated, cross-source KPI rollup. One row per (date, source, metric_name).
 * `period_comparison_pct` is the % change vs. the prior comparable period,
 * pre-computed by the sync job (e.g. day-over-day, week-over-week).
 */
export interface DailyKPI {
  date: string;
  source: string;
  metric_name: string;
  metric_value: number;
  period_comparison_pct: number | null;
}

/** Google Analytics 4 — session/traffic rollup, segmented by channel/source/medium/campaign. */
export interface GATraffic {
  date: string;
  sessions: number;
  users: number;
  new_users: number;
  pageviews: number;
  bounce_rate: number;
  avg_session_duration: number;
  channel: string;
  source: string;
  medium: string;
  campaign: string | null;
}

/** Google Analytics 4 — per-page performance. */
export interface GAPage {
  date: string;
  page_path: string;
  page_title: string;
  pageviews: number;
  avg_time_on_page: number;
  exit_rate: number;
  entrances: number;
}

/** Google Analytics 4 — event tracking (custom events, conversions, etc.). */
export interface GAEvent {
  date: string;
  event_name: string;
  event_count: number;
  users: number;
  event_value: number | null;
  is_conversion: boolean;
}

/** Google Analytics 4 — geographic + device/tech breakdown. */
export interface GAGeo {
  date: string;
  country: string;
  city: string;
  users: number;
  sessions: number;
  device_category: string;
  browser: string;
  os: string;
}

/** Google Search Console — query-level search performance. */
export interface GSCQuery {
  date: string;
  query: string;
  page: string;
  impressions: number;
  clicks: number;
  ctr: number;
  position: number;
}

/** Google Search Console — page-level search performance. */
export interface GSCPage {
  date: string;
  page: string;
  impressions: number;
  clicks: number;
  ctr: number;
  position: number;
}

/** Google Play Console — install/uninstall/active-device counts, by country. */
export interface PlayInstall {
  date: string;
  installs: number;
  uninstalls: number;
  active_devices: number;
  update_installs: number;
  country: string;
}

/** Google Play Console — app rating distribution and review volume. */
export interface PlayRating {
  date: string;
  avg_rating: number;
  total_ratings: number;
  star_1: number;
  star_2: number;
  star_3: number;
  star_4: number;
  star_5: number;
  reviews_count: number;
}

/** Google Play Console — store listing (page) performance, by country. */
export interface PlayStoreListing {
  date: string;
  impressions: number;
  visits: number;
  installs: number;
  install_conversion_rate: number;
  country: string;
}

/** Short.io — link metadata/configuration. One row per shortened link (not time-series). */
export interface ShortIOLink {
  id: string;
  link_id: string;
  short_url: string;
  original_url: string;
  title: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  created_at: string;
}

/** Short.io — daily click analytics for a given link. */
export interface ShortIOClick {
  date: string;
  link_id: string;
  total_clicks: number;
  human_clicks: number;
  country: string | null;
  city: string | null;
  os: string | null;
  browser: string | null;
  referrer: string | null;
}

/** Microsoft Clarity — daily session-quality/engagement rollup. */
export interface ClaritySession {
  date: string;
  sessions: number;
  bot_sessions_excluded: number;
  pages_per_session: number;
  scroll_depth_pct: number;
  active_time_sec: number;
  total_time_sec: number;
  unique_users: number;
  new_user_pct: number;
}

/** Microsoft Clarity — per-page UX friction signals (rage clicks, dead clicks, etc.). */
export interface ClarityFriction {
  date: string;
  page_url: string;
  rage_clicks_pct: number;
  rage_clicks_sessions: number;
  dead_clicks_pct: number;
  dead_clicks_sessions: number;
  excessive_scrolling_pct: number;
  excessive_scrolling_sessions: number;
  quick_backs_pct: number;
  quick_backs_sessions: number;
}

/** Conversion funnel — one row per (date, stage), ordered by `stage_order`. */
export interface FunnelStage {
  date: string;
  stage_name: string;
  stage_order: number;
  users_entered: number;
  users_exited: number;
  conversion_rate: number;
  drop_off_rate: number;
}

/** Business transactions (orders, purchases, subscriptions, etc.). */
export interface Transaction {
  id: string;
  date: string;
  transaction_type: string;
  count: number;
  total_value: number;
  currency: string;
  product: string | null;
}

/** Revenue rollup, by source. */
export interface Revenue {
  date: string;
  source: string;
  amount: number;
  currency: string;
  transaction_count: number;
}

/** Category of an event tracked via {@link TrackedEvent}. */
export type TrackedEventCategory = 'transaction' | 'engagement' | 'conversion' | 'custom';

/** Configuration/registry row describing how a named event should be treated across the dashboard. */
export interface TrackedEvent {
  id: string;
  event_name: string;
  display_name: string;
  category: TrackedEventCategory;
  is_active: boolean;
  track_as_revenue: boolean;
  created_at: string;
  updated_at: string;
}

/** Lifecycle status of a {@link DataSyncLog} entry. */
export type DataSyncStatus = 'running' | 'success' | 'error';

/** Audit log of ingestion/sync jobs pulling data from external sources into Supabase. */
export interface DataSyncLog {
  id: string;
  source: string;
  started_at: string;
  completed_at: string | null;
  status: DataSyncStatus;
  records_synced: number | null;
  error_message: string | null;
}

/* ------------------------------------------------------------------------ */
/*  2. DASHBOARD COMPONENT PROP TYPES                                        */
/* ------------------------------------------------------------------------ */

/** Directional trend indicator, generally derived from a {@link KPICardProps.change} sign. */
export type Trend = 'up' | 'down' | 'flat';

/** Props for a summary metric ("KPI") card. */
export interface KPICardProps {
  title: string;
  value: string | number;
  /** Percentage change vs. the comparison period, e.g. `12.4` means +12.4%. */
  change: number;
  changeLabel: string;
  icon: LucideIcon;
  trend: Trend;
}

/** A single point on a time-series chart. */
export interface ChartDataPoint {
  date: string;
  value: number;
  label?: string;
}

/** A single stage rendered in a funnel visualization. */
export interface FunnelStep {
  name: string;
  value: number;
  percentage: number;
  dropOff: number;
}

/** A selectable/displayable date range, with a human-readable label (e.g. "Last 30 days"). */
export interface DateRange {
  startDate: string;
  endDate: string;
  label: string;
}

/** Identifier for one of the dashboard's upstream analytics data sources. */
export type DataSource = 'ga4' | 'gsc' | 'play' | 'shortio' | 'clarity';

/** Display model for a data source's sync/health status widget. */
export interface SyncStatus {
  source: DataSource;
  lastSync: Date | null;
  status: DataSyncStatus;
  recordCount: number;
}

/* ------------------------------------------------------------------------ */
/*  3. API RESPONSE TYPES                                                    */
/* ------------------------------------------------------------------------ */

/**
 * Generic success/error envelope returned by every internal dashboard API route.
 * `data` is present (and `error` absent) on success; the inverse on failure.
 */
export type ApiResponse<T> =
  | { success: true; data: T; error?: never }
  | { success: false; data?: never; error: string };

/** Common pagination metadata attached to list-style API responses. */
export interface PaginationMeta {
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

/** A paginated collection of rows, e.g. `PaginatedResult<GAPage>`. */
export interface PaginatedResult<T> {
  rows: T[];
  pagination: PaginationMeta;
}

/** GET /api/ga4/traffic response payload. */
export type GATrafficResponse = ApiResponse<{
  rows: GATraffic[];
  totals: Pick<GATraffic, 'sessions' | 'users' | 'new_users' | 'pageviews'>;
}>;

/** GET /api/ga4/pages response payload. */
export type GAPageResponse = ApiResponse<PaginatedResult<GAPage>>;

/** GET /api/ga4/events response payload. */
export type GAEventResponse = ApiResponse<{
  rows: GAEvent[];
  conversionEvents: GAEvent[];
}>;

/** GET /api/ga4/geo response payload. */
export type GAGeoResponse = ApiResponse<GAGeo[]>;

/** GET /api/gsc/queries response payload. */
export type GSCQueryResponse = ApiResponse<PaginatedResult<GSCQuery>>;

/** GET /api/gsc/pages response payload. */
export type GSCPageResponse = ApiResponse<PaginatedResult<GSCPage>>;

/** GET /api/play/installs response payload. */
export type PlayInstallResponse = ApiResponse<{
  rows: PlayInstall[];
  totals: Pick<PlayInstall, 'installs' | 'uninstalls' | 'active_devices'>;
}>;

/** GET /api/play/ratings response payload. */
export type PlayRatingResponse = ApiResponse<PlayRating[]>;

/** GET /api/play/listing response payload. */
export type PlayStoreListingResponse = ApiResponse<PlayStoreListing[]>;

/** GET /api/shortio/links response payload. */
export type ShortIOLinkResponse = ApiResponse<ShortIOLink[]>;

/** GET /api/shortio/clicks response payload. */
export type ShortIOClickResponse = ApiResponse<{
  rows: ShortIOClick[];
  totalClicks: number;
  totalHumanClicks: number;
}>;

/** GET /api/clarity/sessions response payload. */
export type ClaritySessionResponse = ApiResponse<ClaritySession[]>;

/** GET /api/clarity/friction response payload. */
export type ClarityFrictionResponse = ApiResponse<ClarityFriction[]>;

/** GET /api/funnel response payload. */
export type FunnelStageResponse = ApiResponse<FunnelStage[]>;

/** GET /api/transactions response payload. */
export type TransactionResponse = ApiResponse<PaginatedResult<Transaction>>;

/** GET /api/revenue response payload. */
export type RevenueResponse = ApiResponse<{
  rows: Revenue[];
  totalAmount: number;
}>;

/** GET /api/events/tracked response payload. */
export type TrackedEventResponse = ApiResponse<TrackedEvent[]>;

/** GET /api/sync/status response payload. */
export type DataSyncLogResponse = ApiResponse<DataSyncLog[]>;

/** GET /api/kpis response payload — the cross-source rollup feeding {@link KPICardProps}. */
export type DailyKPIResponse = ApiResponse<DailyKPI[]>;

/* ------------------------------------------------------------------------ */
/*  4. UTILITY TYPES                                                        */
/* ------------------------------------------------------------------------ */

/** Current-vs-previous comparison for any single metric. */
export interface MetricComparison {
  current: number;
  previous: number;
  changePercent: number;
  trend: Trend;
}

/** Preset (or custom) reporting window selector used throughout the dashboard's filter controls. */
export type PeriodOption = '7d' | '30d' | '90d' | 'custom';
