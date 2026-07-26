import Header from '@/components/layout/Header'
import KPICard from '@/components/cards/KPICard'
import AreaChart, { type AreaChartDataPoint } from '@/components/charts/AreaChart'
import BarChart, { type BarChartDataPoint } from '@/components/charts/BarChart'
import DataTable, { type DataTableColumn } from '@/components/tables/DataTable'
import { formatNumber, formatPercent } from '@/lib/utils/format'
import { createServiceClient } from '@/lib/supabase/server'
import { getDateWindow } from '@/lib/utils/date-range'

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------
// This is a Server Component. Historically this page queried Play Console
// API-backed tables directly (`play_installs`, `play_store_listing`) for
// install/funnel numbers. The Play Developer Reporting API those tables
// depend on requires per-app enablement and only backfills a rolling
// ~30-60 day window (see lib/api-clients/play-console.ts), so it's an
// unreliable primary source. This version instead treats Sahal Wallet's
// Firebase-linked GA4 property (`ga_events`, synced via
// fetchGA4AppEvents -> ga_events) as the primary source for installs,
// active users, onboarding, and feature-usage metrics, and only reaches
// into `play_installs` / `play_ratings` for the numbers GA4 doesn't carry
// (store-reported install counts and star ratings) — those two tables are
// expected to be populated by a Play Store / App Store *scraper* going
// forward rather than the Play Console API, but this query layer doesn't
// care which sync method wrote them as long as the column shapes match the
// existing schema (see supabase/migrations/001_initial_schema.sql).
//
// Firebase/GA4 event names this page depends on (Sahal Wallet app):
//   first_open                    - first app open on a device (install proxy)
//   session_start                 - app session start (active-usage proxy)
//   SA_GET_STARTED                - "Get Started" screen shown post-open
//   SA_APP_DASHBOARD              - user reached the main app dashboard
//   EW_ONBOARDING_GUIDE_COMPLETE  - user completed the onboarding guide
//   EA_SEND_%                     - send/transfer transaction events (wildcard prefix)
//   EA_T_%                        - tile click events, e.g. EA_T_AppScreen,
//                                    EA_T_PersonalizeWallet, EA_T_MIROStaking,
//                                    EA_T_MRHBStore
//
// Every section below is independently guarded and falls back to its slice
// of MOCK_APP_PERFORMANCE_DATA when the real query returns no usable rows —
// keeps the page renderable well before every event name here has synced.

interface KPIMetric {
  value: number
  change: number
}

interface FunnelStep {
  label: string
  value: number
}

interface RatingBucket {
  label: string
  value: number
}

interface StoreRating {
  store: string
  avgRating: number
  reviewsCount: number
}

interface FeatureUsageRow {
  feature: string
  eventName: string
  clicks: number
}

interface RecentActivityRow {
  eventName: string
  eventCount: number
  users: number
}

interface AppPerformanceData {
  totalInstalls: KPIMetric
  activeUsers: KPIMetric
  avgRating: KPIMetric
  onboardingRate: KPIMetric
  transactionRate: KPIMetric
  usageTrend: AreaChartDataPoint[]
  onboardingFunnel: FunnelStep[]
  ratingDistribution: RatingBucket[]
  storeRatings: StoreRating[]
  featureUsage: FeatureUsageRow[]
  recentActivity: RecentActivityRow[]
}

const MOCK_APP_PERFORMANCE_DATA: AppPerformanceData = {
  totalInstalls: { value: 6320, change: 12.1 },
  activeUsers: { value: 4180, change: 6.8 },
  avgRating: { value: 4.2, change: 2.4 },
  onboardingRate: { value: 68.4, change: 3.1 },
  transactionRate: { value: 41.2, change: 5.6 },

  // 30-day daily first_open (new installs) vs. session_start (active users)
  usageTrend: [
    { date: 'Jun 24', value: 168, secondaryValue: 720 },
    { date: 'Jun 25', value: 172, secondaryValue: 745 },
    { date: 'Jun 26', value: 159, secondaryValue: 702 },
    { date: 'Jun 27', value: 181, secondaryValue: 768 },
    { date: 'Jun 28', value: 195, secondaryValue: 812 },
    { date: 'Jun 29', value: 203, secondaryValue: 840 },
    { date: 'Jun 30', value: 188, secondaryValue: 790 },
    { date: 'Jul 01', value: 176, secondaryValue: 755 },
    { date: 'Jul 02', value: 190, secondaryValue: 803 },
    { date: 'Jul 03', value: 212, secondaryValue: 865 },
    { date: 'Jul 04', value: 224, secondaryValue: 902 },
    { date: 'Jul 05', value: 208, secondaryValue: 850 },
    { date: 'Jul 06', value: 199, secondaryValue: 820 },
    { date: 'Jul 07', value: 215, secondaryValue: 878 },
    { date: 'Jul 08', value: 231, secondaryValue: 930 },
    { date: 'Jul 09', value: 219, secondaryValue: 895 },
    { date: 'Jul 10', value: 206, secondaryValue: 845 },
    { date: 'Jul 11', value: 228, secondaryValue: 912 },
    { date: 'Jul 12', value: 241, secondaryValue: 958 },
    { date: 'Jul 13', value: 235, secondaryValue: 940 },
    { date: 'Jul 14', value: 222, secondaryValue: 900 },
    { date: 'Jul 15', value: 244, secondaryValue: 968 },
    { date: 'Jul 16', value: 256, secondaryValue: 1010 },
    { date: 'Jul 17', value: 248, secondaryValue: 985 },
    { date: 'Jul 18', value: 233, secondaryValue: 935 },
    { date: 'Jul 19', value: 251, secondaryValue: 995 },
    { date: 'Jul 20', value: 267, secondaryValue: 1052 },
    { date: 'Jul 21', value: 259, secondaryValue: 1025 },
    { date: 'Jul 22', value: 242, secondaryValue: 965 },
    { date: 'Jul 23', value: 263, secondaryValue: 1040 },
  ],

  // Onboarding funnel: first_open -> Get Started -> Dashboard -> Onboarding complete
  onboardingFunnel: [
    { label: 'App Opened', value: 6320 },
    { label: 'Get Started', value: 5410 },
    { label: 'Reached Dashboard', value: 4760 },
    { label: 'Onboarding Complete', value: 4323 },
  ],

  ratingDistribution: [
    { label: '5 star', value: 0 },
    { label: '4 star', value: 0 },
    { label: '3 star', value: 0 },
    { label: '2 star', value: 0 },
    { label: '1 star', value: 0 },
  ],

  storeRatings: [
    { store: 'Google Play', avgRating: 4.2, reviewsCount: 5000 },
    { store: 'App Store', avgRating: 4.4, reviewsCount: 1210 },
  ],

  featureUsage: [
    { feature: 'App Screen', eventName: 'EA_T_AppScreen', clicks: 8420 },
    { feature: 'Personalize Wallet', eventName: 'EA_T_PersonalizeWallet', clicks: 3110 },
    { feature: 'MIRO Staking', eventName: 'EA_T_MIROStaking', clicks: 2260 },
    { feature: 'MRHB Store', eventName: 'EA_T_MRHBStore', clicks: 1485 },
  ],

  recentActivity: [
    { eventName: 'session_start', eventCount: 4180, users: 3920 },
    { eventName: 'first_open', eventCount: 263, users: 263 },
    { eventName: 'SA_APP_DASHBOARD', eventCount: 3640, users: 3410 },
    { eventName: 'EA_T_AppScreen', eventCount: 1120, users: 980 },
    { eventName: 'EW_ONBOARDING_GUIDE_COMPLETE', eventCount: 214, users: 214 },
    { eventName: 'EA_SEND_TOKEN', eventCount: 186, users: 172 },
    { eventName: 'SA_GET_STARTED', eventCount: 301, users: 301 },
    { eventName: 'EA_T_PersonalizeWallet', eventCount: 158, users: 140 },
  ],
}

// TilesType parsed from an `EA_T_<TilesType>` event name -> human-readable
// feature label. Falls back to a title-cased version of the raw suffix for
// any tile type not explicitly mapped here (keeps the chart useful even if
// the app adds new tiles before this map is updated).
const TILE_FEATURE_LABELS: Record<string, string> = {
  AppScreen: 'App Screen',
  PersonalizeWallet: 'Personalize Wallet',
  MIROStaking: 'MIRO Staking',
  MRHBStore: 'MRHB Store',
}

function formatTrendDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', timeZone: 'UTC' })
}

/** Splits a camel/PascalCase tile-type suffix into spaced words, e.g. "MIROStaking" -> "MIRO Staking". */
function titleCaseTileType(raw: string): string {
  const spaced = raw.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  return spaced.length > 0 ? spaced : raw
}

function tileFeatureLabel(eventName: string): string {
  const suffix = eventName.replace(/^EA_T_/, '')
  return TILE_FEATURE_LABELS[suffix] ?? titleCaseTileType(suffix)
}

/** Percent change of `current` vs `previous`, guarding divide-by-zero. */
function pctChange(current: number, previous: number): number {
  if (!previous) return current > 0 ? 100 : 0
  return ((current - previous) / previous) * 100
}

async function getAppPerformanceData(searchParams?: { range?: string }): Promise<AppPerformanceData> {
  const supabase = createServiceClient()
  const { startDate: since, prevStartDate } = getDateWindow(searchParams)

  const [eventsRes, prevEventsRes, installsRes, ratingsRes] = await Promise.all([
    // Current window: every ga_events row we need, sliced client-side below.
    supabase
      .from('ga_events')
      .select('date, event_name, event_count, users')
      .gte('date', since),
    // Prior comparable window, for KPI period-over-period change.
    supabase
      .from('ga_events')
      .select('date, event_name, event_count, users')
      .gte('date', prevStartDate)
      .lt('date', since),
    // Store-reported installs (Play Store + App Store scraper, or legacy
    // Play Console sync — same table, either source). Kept as a fallback/
    // supplement to the first_open-based install count.
    supabase
      .from('play_installs')
      .select('date, installs, uninstalls, active_devices, country')
      .gte('date', since)
      .order('date', { ascending: true }),
    // Latest combined Play Store / App Store rating snapshot.
    supabase
      .from('play_ratings')
      .select('date, avg_rating, total_ratings, star_1, star_2, star_3, star_4, star_5, reviews_count')
      .order('date', { ascending: false })
      .limit(2),
  ])

  const events = eventsRes.data ?? []
  const prevEvents = prevEventsRes.data ?? []
  const installs = installsRes.data ?? []
  const ratings = ratingsRes.data ?? []

  const hasEvents = !eventsRes.error && events.length > 0

  if (!hasEvents) {
    return MOCK_APP_PERFORMANCE_DATA
  }

  // ---- Helpers over the fetched ga_events rows -----------------------------

  type EventRow = { date: string; event_name: string; event_count: number; users: number }

  const sumByEventName = (rows: EventRow[], name: string): number =>
    rows.filter((r) => r.event_name === name).reduce((sum, r) => sum + (r.event_count ?? 0), 0)

  const sumUsersByEventName = (rows: EventRow[], name: string): number =>
    rows.filter((r) => r.event_name === name).reduce((sum, r) => sum + (r.users ?? 0), 0)

  const sumByPrefix = (rows: EventRow[], prefix: string): number =>
    rows
      .filter((r) => r.event_name.startsWith(prefix))
      .reduce((sum, r) => sum + (r.event_count ?? 0), 0)

  // ---- KPI 1: Total Installs -----------------------------------------------
  // Prefer store-reported installs (scraper-fed play_installs) when present;
  // fall back to GA4 `first_open` as a proxy for new installs in the window.
  const worldwideInstalls = installs.filter((r) => r.country === 'ALL')
  const installRows = worldwideInstalls.length > 0 ? worldwideInstalls : installs
  const storeInstallTotal = installRows.reduce((sum, r) => sum + (r.installs ?? 0), 0)
  const firstOpenTotal = sumByEventName(events, 'first_open')
  const prevFirstOpenTotal = sumByEventName(prevEvents, 'first_open')

  const totalInstalls: KPIMetric =
    storeInstallTotal > 0
      ? { value: storeInstallTotal, change: MOCK_APP_PERFORMANCE_DATA.totalInstalls.change }
      : { value: firstOpenTotal, change: pctChange(firstOpenTotal, prevFirstOpenTotal) }

  // ---- KPI 2: Active Users --------------------------------------------------
  // Prefer summed event_count (total sessions); if GA4 hasn't populated
  // event_count for session_start yet but has populated the users column,
  // fall back to summed unique users so the KPI doesn't read as a hard zero.
  const sessionStartTotal = sumByEventName(events, 'session_start')
  const prevSessionStartTotal = sumByEventName(prevEvents, 'session_start')
  const sessionStartUserTotal = sumUsersByEventName(events, 'session_start')
  const prevSessionStartUserTotal = sumUsersByEventName(prevEvents, 'session_start')
  const activeUsersValue = sessionStartTotal > 0 ? sessionStartTotal : sessionStartUserTotal
  const activeUsersPrevValue = sessionStartTotal > 0 ? prevSessionStartTotal : prevSessionStartUserTotal
  const activeUsers: KPIMetric = {
    value: activeUsersValue,
    change: pctChange(activeUsersValue, activeUsersPrevValue),
  }

  // ---- KPI 3: Avg Rating (combined Play Store + App Store) ------------------
  const latestRating = ratings[0]
  const previousRating = ratings[1]
  const avgRating: KPIMetric = latestRating
    ? {
        value: latestRating.avg_rating ?? 0,
        change: previousRating
          ? pctChange(latestRating.avg_rating ?? 0, previousRating.avg_rating ?? 0)
          : MOCK_APP_PERFORMANCE_DATA.avgRating.change,
      }
    : MOCK_APP_PERFORMANCE_DATA.avgRating

  // ---- KPI 4: Onboarding Rate = onboarding completes / first_open ----------
  const onboardingCompleteTotal = sumByEventName(events, 'EW_ONBOARDING_GUIDE_COMPLETE')
  const prevOnboardingCompleteTotal = sumByEventName(prevEvents, 'EW_ONBOARDING_GUIDE_COMPLETE')
  const onboardingRateCurrent = firstOpenTotal > 0 ? (onboardingCompleteTotal / firstOpenTotal) * 100 : 0
  const onboardingRatePrevious =
    prevFirstOpenTotal > 0 ? (prevOnboardingCompleteTotal / prevFirstOpenTotal) * 100 : 0
  const onboardingRate: KPIMetric =
    firstOpenTotal > 0
      ? { value: onboardingRateCurrent, change: pctChange(onboardingRateCurrent, onboardingRatePrevious) }
      : MOCK_APP_PERFORMANCE_DATA.onboardingRate

  // ---- KPI 5: Transaction Rate = EA_SEND_* / SA_APP_DASHBOARD --------------
  const sendEventsTotal = sumByPrefix(events, 'EA_SEND_')
  const prevSendEventsTotal = sumByPrefix(prevEvents, 'EA_SEND_')
  const dashboardTotal = sumByEventName(events, 'SA_APP_DASHBOARD')
  const prevDashboardTotal = sumByEventName(prevEvents, 'SA_APP_DASHBOARD')
  const transactionRateCurrent = dashboardTotal > 0 ? (sendEventsTotal / dashboardTotal) * 100 : 0
  const transactionRatePrevious = prevDashboardTotal > 0 ? (prevSendEventsTotal / prevDashboardTotal) * 100 : 0
  const transactionRate: KPIMetric =
    dashboardTotal > 0
      ? { value: transactionRateCurrent, change: pctChange(transactionRateCurrent, transactionRatePrevious) }
      : MOCK_APP_PERFORMANCE_DATA.transactionRate

  // ---- Install / Active Users trend -----------------------------------------
  // Daily first_open (installs proxy) vs. session_start (active users),
  // merged into one series keyed by date.
  const byDate = new Map<string, { installs: number; active: number }>()
  for (const row of events) {
    if (row.event_name !== 'first_open' && row.event_name !== 'session_start') continue
    const entry = byDate.get(row.date) ?? { installs: 0, active: 0 }
    if (row.event_name === 'first_open') entry.installs += row.event_count ?? 0
    if (row.event_name === 'session_start') entry.active += row.event_count ?? 0
    byDate.set(row.date, entry)
  }
  const usageTrend: AreaChartDataPoint[] = Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, agg]) => ({
      date: formatTrendDate(date),
      value: agg.installs,
      secondaryValue: agg.active,
    }))

  // ---- Onboarding funnel: first_open -> SA_GET_STARTED -> SA_APP_DASHBOARD -> onboarding complete
  const getStartedTotal = sumByEventName(events, 'SA_GET_STARTED')
  const onboardingFunnelSteps: FunnelStep[] = [
    { label: 'App Opened', value: firstOpenTotal },
    { label: 'Get Started', value: getStartedTotal },
    { label: 'Reached Dashboard', value: dashboardTotal },
    { label: 'Onboarding Complete', value: onboardingCompleteTotal },
  ]
  const hasOnboardingFunnel = onboardingFunnelSteps.some((s) => s.value > 0)
  const onboardingFunnel = hasOnboardingFunnel
    ? onboardingFunnelSteps
    : MOCK_APP_PERFORMANCE_DATA.onboardingFunnel

  // ---- Rating distribution + per-store ratings -------------------------------
  // Note: play_ratings has no store-specific column in the current schema, so
  // both Play Store and App Store display the same combined snapshot until a
  // per-store breakdown is synced — better than fabricating separate numbers.
  const ratingDistribution: RatingBucket[] = latestRating
    ? [
        { label: '5 star', value: latestRating.star_5 ?? 0 },
        { label: '4 star', value: latestRating.star_4 ?? 0 },
        { label: '3 star', value: latestRating.star_3 ?? 0 },
        { label: '2 star', value: latestRating.star_2 ?? 0 },
        { label: '1 star', value: latestRating.star_1 ?? 0 },
      ]
    : MOCK_APP_PERFORMANCE_DATA.ratingDistribution

  const storeRatings: StoreRating[] = latestRating
    ? [
        { store: 'Google Play', avgRating: latestRating.avg_rating ?? 0, reviewsCount: latestRating.reviews_count ?? 0 },
        { store: 'App Store', avgRating: latestRating.avg_rating ?? 0, reviewsCount: latestRating.reviews_count ?? 0 },
      ]
    : MOCK_APP_PERFORMANCE_DATA.storeRatings

  // ---- Feature usage: EA_T_* tile-click events -------------------------------
  const tileEvents = events.filter((r) => r.event_name.startsWith('EA_T_'))
  const tileTotals = new Map<string, number>()
  for (const row of tileEvents) {
    tileTotals.set(row.event_name, (tileTotals.get(row.event_name) ?? 0) + (row.event_count ?? 0))
  }
  const featureUsageRows: FeatureUsageRow[] = Array.from(tileTotals.entries())
    .map(([eventName, clicks]) => ({
      feature: tileFeatureLabel(eventName),
      eventName,
      clicks,
    }))
    .sort((a, b) => b.clicks - a.clicks)
  const featureUsage = featureUsageRows.length > 0 ? featureUsageRows : MOCK_APP_PERFORMANCE_DATA.featureUsage

  // ---- Recent activity: top events on the most recent day with data ---------
  const latestEventDate = events.reduce<string | null>((latest, r) => {
    if (!latest || r.date > latest) return r.date
    return latest
  }, null)
  const latestDayRows = latestEventDate ? events.filter((r) => r.date === latestEventDate) : []
  const recentActivityRows: RecentActivityRow[] = latestDayRows
    .map((r) => ({ eventName: r.event_name, eventCount: r.event_count ?? 0, users: r.users ?? 0 }))
    .sort((a, b) => b.eventCount - a.eventCount)
    .slice(0, 10)
  const recentActivity = recentActivityRows.length > 0 ? recentActivityRows : MOCK_APP_PERFORMANCE_DATA.recentActivity

  return {
    totalInstalls,
    activeUsers,
    avgRating,
    onboardingRate,
    transactionRate,
    usageTrend: usageTrend.length > 0 ? usageTrend : MOCK_APP_PERFORMANCE_DATA.usageTrend,
    onboardingFunnel,
    ratingDistribution,
    storeRatings,
    featureUsage,
    recentActivity,
  }
}

function getTrend(change: number): 'up' | 'down' | 'flat' {
  if (change > 0) return 'up'
  if (change < 0) return 'down'
  return 'flat'
}

function buildFunnelBars(steps: FunnelStep[]): BarChartDataPoint[] {
  return steps.map((step) => ({ label: step.label, value: step.value }))
}

function funnelConversionRates(steps: FunnelStep[]): { from: string; to: string; rate: number }[] {
  const rates: { from: string; to: string; rate: number }[] = []
  for (let i = 1; i < steps.length; i++) {
    const prev = steps[i - 1]
    const curr = steps[i]
    rates.push({
      from: prev.label,
      to: curr.label,
      rate: prev.value > 0 ? (curr.value / prev.value) * 100 : 0,
    })
  }
  return rates
}

function buildFeatureUsageBars(rows: FeatureUsageRow[]): BarChartDataPoint[] {
  return rows.map((row) => ({ label: row.feature, value: row.clicks }))
}

const RECENT_ACTIVITY_COLUMNS: DataTableColumn[] = [
  { key: 'eventName', label: 'Event Name', align: 'left', sortable: true },
  { key: 'eventCount', label: 'Event Count', align: 'right', sortable: true },
  { key: 'users', label: 'Users', align: 'right', sortable: true },
]

export default async function AppPerformancePage({
  searchParams,
}: {
  searchParams: { range?: string }
}) {
  const data = await getAppPerformanceData(searchParams)
  const funnelBars = buildFunnelBars(data.onboardingFunnel)
  const conversionRates = funnelConversionRates(data.onboardingFunnel)
  const featureUsageBars = buildFeatureUsageBars(data.featureUsage)

  const recentActivityRows = data.recentActivity.map((row) => ({
    eventName: row.eventName,
    eventCount: formatNumber(row.eventCount),
    users: formatNumber(row.users),
  }))

  return (
    <div>
      <Header title="App Performance" />

      {/* KPI cards row */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <KPICard
          title="Total Installs"
          value={formatNumber(data.totalInstalls.value)}
          change={data.totalInstalls.change}
          trend={getTrend(data.totalInstalls.change)}
          iconName="smartphone"
          tooltip="Store-reported installs (Play Store / App Store), or GA4 first_open events as a proxy when store data isn't synced yet"
        />
        <KPICard
          title="Active Users"
          value={formatNumber(data.activeUsers.value)}
          change={data.activeUsers.change}
          trend={getTrend(data.activeUsers.change)}
          iconName="users"
          tooltip="App sessions started (GA4 session_start) in the selected date range"
        />
        <KPICard
          title="Avg Rating"
          value={data.avgRating.value.toFixed(1)}
          change={data.avgRating.change}
          trend={getTrend(data.avgRating.change)}
          iconName="trending-up"
          tooltip="Combined average star rating across Play Store and App Store (out of 5)"
        />
        <KPICard
          title="Onboarding Rate"
          value={formatPercent(data.onboardingRate.value)}
          change={data.onboardingRate.change}
          trend={getTrend(data.onboardingRate.change)}
          iconName="filter"
          tooltip="Percentage of app opens that complete the onboarding guide (EW_ONBOARDING_GUIDE_COMPLETE / first_open)"
        />
        <KPICard
          title="Transaction Rate"
          value={formatPercent(data.transactionRate.value)}
          change={data.transactionRate.change}
          trend={getTrend(data.transactionRate.change)}
          iconName="dollar-sign"
          tooltip="Percentage of users reaching the dashboard who initiate a send/transfer (EA_SEND_* / SA_APP_DASHBOARD)"
        />
      </div>

      {/* Install / active users trend */}
      <div className="mb-6">
        <AreaChart
          data={data.usageTrend}
          title="Installs vs. Active Users (30 Days)"
          color="#01A6FA"
          fillColor="#D0EFFF"
          seriesLabel="New Installs"
          secondarySeriesLabel="Active Users"
          secondaryColor="#E5B897"
          height={320}
        />
      </div>

      {/* Two-column grid: onboarding funnel + rating distribution */}
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Onboarding funnel */}
        <div>
          <BarChart
            data={funnelBars}
            title="Onboarding Funnel"
            color="#01A6FA"
            height={280}
            layout="vertical"
          />
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {conversionRates.map((rate) => (
              <div
                key={`${rate.from}-${rate.to}`}
                className="rounded-xl bg-mrhb-white p-4 shadow-sm"
              >
                <p className="text-xs font-medium text-mrhb-dark/50">
                  {rate.from} → {rate.to}
                </p>
                <p className="mt-1 text-lg font-semibold text-mrhb-blue">
                  {formatPercent(rate.rate)}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Rating distribution */}
        <div>
          <BarChart
            data={data.ratingDistribution}
            title="Rating Distribution"
            color="#E5B897"
            height={280}
            layout="horizontal"
          />
          <p className="mt-2 text-xs text-mrhb-dark/50">
            Star-by-star breakdown may show 0s until the Play Store / App Store scraper provides a full distribution.
          </p>
        </div>
      </div>

      {/* Store ratings side by side */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {data.storeRatings.map((store) => (
          <div key={store.store} className="rounded-xl bg-mrhb-white p-5 shadow-sm">
            <p className="text-sm font-medium text-mrhb-dark/60">{store.store}</p>
            <div className="mt-2 flex items-baseline gap-2">
              <p className="text-2xl font-semibold text-mrhb-dark">{store.avgRating.toFixed(1)}</p>
              <span className="text-mrhb-warm-tan">★</span>
            </div>
            <p className="mt-1 text-xs text-mrhb-dark/50">
              {formatNumber(store.reviewsCount)} reviews
            </p>
          </div>
        ))}
      </div>

      {/* Feature usage — tile click events */}
      <div className="mb-6">
        <BarChart
          data={featureUsageBars}
          title="Feature Usage (Tile Clicks)"
          color="#01A6FA"
          height={320}
          layout="vertical"
        />
      </div>

      {/* Recent activity */}
      <div>
        <DataTable
          columns={RECENT_ACTIVITY_COLUMNS}
          data={recentActivityRows}
          title="Recent Activity (Most Recent Day)"
          emptyMessage="No event data available for this period."
        />
      </div>
    </div>
  )
}
