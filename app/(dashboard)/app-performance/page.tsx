import Header from '@/components/layout/Header'
import KPICard from '@/components/cards/KPICard'
import AreaChart, { type AreaChartDataPoint } from '@/components/charts/AreaChart'
import BarChart, { type BarChartDataPoint } from '@/components/charts/BarChart'
import DataTable, { type DataTableColumn } from '@/components/tables/DataTable'
import { formatNumber, formatPercent } from '@/lib/utils/format'
import { createServiceClient } from '@/lib/supabase/server'
import { getDateWindow } from '@/lib/utils/date-range'
import { fetchGA4AppActiveUsersTotal } from '@/lib/api-clients/ga4-app-active-total'
import { fetchRecentPlayReviews, type PlayReviewItem } from '@/lib/api-clients/play-reviews'
import { computeToolStats, computeToolTrend, DEFAULT_TOOL_MAPPINGS, type ToolMapping, type ToolStat } from '@/lib/config/tool-usage'

// ---------------------------------------------------------------------------
// App Performance (Sahal Wallet) — reworked for correctness.
//
// PRIMARY SOURCE: the Firebase-linked GA4 app property via `ga_events`
// (paginated — the 30/90-day windows exceed Supabase's 1,000-row cap).
// Event names are matched ACROSS PLATFORMS (SA_/SI_/SW_ screens and
// EA_/EI_/EW_ actions), because onboarding/transaction events are largely
// EA_/EI_ (Android/iOS), not EW_ (web).
//
// STORE SOURCE: `play_installs` holds the Play Store listing's CUMULATIVE
// install badge (e.g. 100,000+) snapshotted every day — it is NOT daily new
// installs, so we use the LATEST snapshot (never a sum). `play_ratings` holds
// the combined Play rating (avg + review count); its per-star breakdown isn't
// provided by the listing (all zeros). App Store is not connected (needs App
// Store Connect / the RU storefront), so it renders "Not connected" rather
// than duplicating Play's numbers.
//
// Anything not sourced is surfaced in a banner and never presented as live.
// ---------------------------------------------------------------------------

interface KPIMetric {
  value: number
  change: number | null
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
  connected: boolean
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
  installsLifetime: boolean
  installsSourced: boolean
  activeUsers: KPIMetric
  activeUsersSourced: boolean
  avgRating: KPIMetric
  ratingsSourced: boolean
  onboardingRate: KPIMetric
  transactionRate: KPIMetric
  usageTrend: AreaChartDataPoint[]
  onboardingFunnel: FunnelStep[]
  ratingDistribution: RatingBucket[]
  starBreakdownAvailable: boolean
  starBreakdownFromSample: boolean
  storeRatings: StoreRating[]
  featureUsage: FeatureUsageRow[]
  recentActivity: RecentActivityRow[]
  recentReviews: PlayReviewItem[]
  reviewsSampledCount: number
  toolStats: ToolStat[]
  toolTrend: Array<{ date: string; events: number; users: number }>
  hasEvents: boolean
}

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

function titleCaseTileType(raw: string): string {
  const spaced = raw.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  return spaced.length > 0 ? spaced : raw
}

function tileFeatureLabel(eventName: string): string {
  const suffix = eventName.replace(/^E[AIW]_T_/, '')
  return TILE_FEATURE_LABELS[suffix] ?? titleCaseTileType(suffix)
}

/** Percent change of current vs previous. Returns null when there's no usable
 * baseline or the swing is implausibly large, instead of a misleading number. */
function pctChange(current: number, previous: number): number | null {
  if (!previous || previous <= 0) return null
  const pct = ((current - previous) / previous) * 100
  if (Math.abs(pct) > 500) return null
  return pct
}

type EventRow = { date: string; event_name: string; event_count: number; users: number }

async function fetchEvents(
  supabase: ReturnType<typeof createServiceClient>,
  gte: string,
  bound: { lte?: string; lt?: string }
): Promise<EventRow[]> {
  const all: EventRow[] = []
  const PAGE = 1000
  for (let p = 0; p < 40; p++) {
    let q = supabase.from('ga_events').select('date, event_name, event_count, users').gte('date', gte)
    if (bound.lte) q = q.lte('date', bound.lte)
    if (bound.lt) q = q.lt('date', bound.lt)
    q = q.order('date', { ascending: true }).range(p * PAGE, p * PAGE + PAGE - 1)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as EventRow[]
    all.push(...rows)
    if (rows.length < PAGE) break
  }
  return all
}

const U = (r: EventRow): string => String(r.event_name ?? '').toUpperCase()
const cnt = (rows: EventRow[], pred: (n: string) => boolean): number =>
  rows.filter((r) => pred(U(r))).reduce((s, r) => s + (Number(r.event_count) || 0), 0)
const usr = (rows: EventRow[], pred: (n: string) => boolean): number =>
  rows.filter((r) => pred(U(r))).reduce((s, r) => s + (Number(r.users) || 0), 0)

const isTx = (n: string): boolean =>
  n.includes('SEND_MONEY') || n.includes('_SEND_') || n.includes('SWAP') || n.includes('SAHAL_RAMP')

async function getAppPerformanceData(searchParams?: { range?: string }): Promise<AppPerformanceData> {
  const supabase = createServiceClient()
  const { startDate: since, endDate: until, prevStartDate } = getDateWindow(searchParams)

  const mockEmpty: AppPerformanceData = {
    totalInstalls: { value: 0, change: null },
    installsLifetime: false,
    installsSourced: false,
    activeUsers: { value: 0, change: null },
    activeUsersSourced: false,
    avgRating: { value: 0, change: null },
    ratingsSourced: false,
    onboardingRate: { value: 0, change: null },
    transactionRate: { value: 0, change: null },
    usageTrend: [],
    onboardingFunnel: [],
    ratingDistribution: [],
    starBreakdownAvailable: false,
    starBreakdownFromSample: false,
    storeRatings: [],
    featureUsage: [],
    recentActivity: [],
    recentReviews: [],
    reviewsSampledCount: 0,
    toolStats: [],
    toolTrend: [],
    hasEvents: false,
  }

  try {
    const [events, prevEvents, installsRes, ratingsRes, activeCur, activePrev, reviews] = await Promise.all([
      fetchEvents(supabase, since, { lte: until }),
      fetchEvents(supabase, prevStartDate, { lt: since }),
      supabase.from('play_installs').select('date, installs, country').order('date', { ascending: false }).limit(180),
      supabase
        .from('play_ratings')
        .select('date, avg_rating, total_ratings, star_1, star_2, star_3, star_4, star_5, reviews_count')
        .order('date', { ascending: false })
        .limit(5),
      fetchGA4AppActiveUsersTotal(since, until),
      fetchGA4AppActiveUsersTotal(prevStartDate, since),
      fetchRecentPlayReviews(2),
    ])

    const hasEvents = events.length > 0

    // ---- Core event aggregates (all-platform, users-based where it means users) ----
    const firstOpen = cnt(events, (n) => n === 'FIRST_OPEN')
    const prevFirstOpen = cnt(prevEvents, (n) => n === 'FIRST_OPEN')
    const completeUsers = usr(events, (n) => n.includes('ONBOARDING_GUIDE_COMPLETE'))
    const prevCompleteUsers = usr(prevEvents, (n) => n.includes('ONBOARDING_GUIDE_COMPLETE'))
    const getStartedUsers = usr(events, (n) => n.includes('GET_STARTED'))
    const dashboardUsers = usr(events, (n) => n.includes('APP_DASHBOARD'))
    const prevDashboardUsers = usr(prevEvents, (n) => n.includes('APP_DASHBOARD'))
    const txUsers = usr(events, isTx)
    const prevTxUsers = usr(prevEvents, isTx)

    // ---- Total Installs: latest store snapshot (lifetime badge), never summed ----
    const installsRows = (installsRes.data ?? []) as any[]
    const allRows = installsRows.filter((r) => r.country === 'ALL')
    const pool = allRows.length > 0 ? allRows : installsRows
    const latestInstall = pool[0] // ordered desc by date
    const priorInstall = pool.find((r) => String(r.date) < since)
    const lifetimeInstalls = latestInstall ? Number(latestInstall.installs) || 0 : 0
    const installsSourced = !!latestInstall && lifetimeInstalls > 0
    const totalInstalls: KPIMetric = installsSourced
      ? { value: lifetimeInstalls, change: priorInstall ? pctChange(lifetimeInstalls, Number(priorInstall.installs) || 0) : null }
      : { value: firstOpen, change: pctChange(firstOpen, prevFirstOpen) }
    const installsLifetime = installsSourced

    // ---- Active Users: authoritative de-duplicated GA4 app metric ----
    const activeUsersSourced = activeCur > 0
    const sessionUsers = usr(events, (n) => n === 'SESSION_START')
    const prevSessionUsers = usr(prevEvents, (n) => n === 'SESSION_START')
    const activeUsers: KPIMetric = activeUsersSourced
      ? { value: activeCur, change: pctChange(activeCur, activePrev) }
      : { value: sessionUsers, change: pctChange(sessionUsers, prevSessionUsers) }

    // ---- Avg Rating (Play Store) ----
    const ratings = (ratingsRes.data ?? []) as any[]
    const latestRating = ratings[0]
    const prevRating = ratings[1]
    const ratingsSourced = !!latestRating
    const avgRating: KPIMetric = ratingsSourced
      ? {
          value: Number(latestRating.avg_rating) || 0,
          change: prevRating ? pctChange(Number(latestRating.avg_rating) || 0, Number(prevRating.avg_rating) || 0) : null,
        }
      : { value: 0, change: null }

    // ---- Onboarding Rate = onboarding-complete users / new installs (approx) ----
    const onbCur = firstOpen > 0 ? (completeUsers / firstOpen) * 100 : 0
    const onbPrev = prevFirstOpen > 0 ? (prevCompleteUsers / prevFirstOpen) * 100 : 0
    const onboardingRate: KPIMetric = { value: onbCur, change: pctChange(onbCur, onbPrev) }

    // ---- Transaction Rate = transacting users / users reaching dashboard ----
    const txCur = dashboardUsers > 0 ? (txUsers / dashboardUsers) * 100 : 0
    const txPrev = prevDashboardUsers > 0 ? (prevTxUsers / prevDashboardUsers) * 100 : 0
    const transactionRate: KPIMetric = { value: txCur, change: pctChange(txCur, txPrev) }

    // ---- Trend: daily new installs (first_open) vs daily active users (session_start users) ----
    const byDate = new Map<string, { installs: number; active: number }>()
    for (const row of events) {
      const n = U(row)
      if (n !== 'FIRST_OPEN' && n !== 'SESSION_START') continue
      const e = byDate.get(row.date) ?? { installs: 0, active: 0 }
      if (n === 'FIRST_OPEN') e.installs += Number(row.event_count) || 0
      if (n === 'SESSION_START') e.active += Number(row.users) || 0
      byDate.set(row.date, e)
    }
    const usageTrend: AreaChartDataPoint[] = Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, e]) => ({ date: formatTrendDate(date), value: e.installs, secondaryValue: e.active }))

    // ---- Onboarding funnel (all-platform, users). App-wide activity, not a cohort. ----
    const onboardingFunnel: FunnelStep[] = [
      { label: 'App Opened', value: firstOpen },
      { label: 'Get Started', value: getStartedUsers },
      { label: 'Reached Dashboard', value: dashboardUsers },
      { label: 'Onboarding Complete', value: completeUsers },
    ]

    // ---- Rating distribution (star breakdown often unavailable → all zeros) ----
    // Prefer a real star distribution from the recent-reviews sample (Android
    // Publisher API); fall back to any stored star columns (usually empty).
    const sampleStars = reviews.sampledCount > 0
    const ratingDistribution: RatingBucket[] = sampleStars
      ? [
          { label: '5 star', value: reviews.distribution.star5 },
          { label: '4 star', value: reviews.distribution.star4 },
          { label: '3 star', value: reviews.distribution.star3 },
          { label: '2 star', value: reviews.distribution.star2 },
          { label: '1 star', value: reviews.distribution.star1 },
        ]
      : latestRating
        ? [
            { label: '5 star', value: Number(latestRating.star_5) || 0 },
            { label: '4 star', value: Number(latestRating.star_4) || 0 },
            { label: '3 star', value: Number(latestRating.star_3) || 0 },
            { label: '2 star', value: Number(latestRating.star_2) || 0 },
            { label: '1 star', value: Number(latestRating.star_1) || 0 },
          ]
        : []
    const starBreakdownFromSample = sampleStars
    const starBreakdownAvailable = ratingDistribution.some((s) => s.value > 0)

    const storeRatings: StoreRating[] = [
      {
        store: 'Google Play',
        avgRating: ratingsSourced ? Number(latestRating.avg_rating) || 0 : 0,
        reviewsCount: ratingsSourced ? Number(latestRating.reviews_count) || 0 : 0,
        connected: ratingsSourced,
      },
      // App Store isn't sourced (needs App Store Connect / RU storefront).
      { store: 'App Store', avgRating: 0, reviewsCount: 0, connected: false },
    ]

    // ---- Feature usage: E?_T_* tile-click events ----
    const tileTotals = new Map<string, number>()
    for (const row of events) {
      if (!/^E[AIW]_T_/.test(U(row))) continue
      tileTotals.set(row.event_name, (tileTotals.get(row.event_name) ?? 0) + (Number(row.event_count) || 0))
    }
    const featureUsage: FeatureUsageRow[] = Array.from(tileTotals.entries())
      .map(([eventName, clicks]) => ({ feature: tileFeatureLabel(eventName), eventName, clicks }))
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, 12)

    // ---- Recent activity: top events on the most recent day with data ----
    const latestEventDate = events.reduce<string | null>((latest, r) => (!latest || r.date > latest ? r.date : latest), null)
    const latestDayRows = latestEventDate ? events.filter((r) => r.date === latestEventDate) : []
    const recentActivity: RecentActivityRow[] = latestDayRows
      .map((r) => ({ eventName: r.event_name, eventCount: Number(r.event_count) || 0, users: Number(r.users) || 0 }))
      .sort((a, b) => b.eventCount - a.eventCount)
      .slice(0, 10)

    // ---- Tool usage (admin-configurable mapping; fallback to defaults) ----
    let toolMappings: ToolMapping[] = DEFAULT_TOOL_MAPPINGS
    try {
      const cfg = await supabase
        .from('tool_usage_config')
        .select('tool, patterns, sort_order, is_active')
        .eq('is_active', true)
      const cfgRows = (cfg.error ? [] : (cfg.data ?? [])) as any[]
      if (cfgRows.length > 0) {
        toolMappings = cfgRows.map((r) => ({
          tool: String(r.tool),
          patterns: String(r.patterns ?? '')
            .split(',')
            .map((s: string) => s.trim().toUpperCase())
            .filter(Boolean),
          sortOrder: Number(r.sort_order) || 0,
          isActive: r.is_active !== false,
        }))
      }
    } catch {
      // tool_usage_config table missing → use defaults
    }
    const toolStats = computeToolStats(events, toolMappings)
    const toolTrend = computeToolTrend(events, toolMappings)

    return {
      totalInstalls,
      installsLifetime,
      installsSourced,
      activeUsers,
      activeUsersSourced,
      avgRating,
      ratingsSourced,
      onboardingRate,
      transactionRate,
      usageTrend,
      onboardingFunnel,
      ratingDistribution,
      starBreakdownAvailable,
      starBreakdownFromSample,
      storeRatings,
      featureUsage,
      recentActivity,
      recentReviews: reviews.reviews,
      reviewsSampledCount: reviews.sampledCount,
      toolStats,
      toolTrend,
      hasEvents,
    }
  } catch {
    return mockEmpty
  }
}

function getTrend(change: number | null): 'up' | 'down' | 'flat' {
  if (!change) return 'flat'
  if (change > 0) return 'up'
  if (change < 0) return 'down'
  return 'flat'
}

const RECENT_ACTIVITY_COLUMNS: DataTableColumn[] = [
  { key: 'eventName', label: 'Event Name', align: 'left', sortable: true },
  { key: 'eventCount', label: 'Event Count', align: 'right', sortable: true },
  { key: 'users', label: 'Users', align: 'right', sortable: true },
]

const RANGE_LABELS: Record<string, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  '7d': 'Last 7 Days',
  '30d': 'Last 30 Days',
  '90d': 'Last 90 Days',
}

const TOOL_USAGE_COLUMNS: DataTableColumn[] = [
  { key: 'tool', label: 'Tool', align: 'left', sortable: true },
  { key: 'users', label: 'Active Users', align: 'right', sortable: true },
  { key: 'events', label: 'Events', align: 'right', sortable: true },
  { key: 'platform', label: 'Android / iOS / Web', align: 'right' },
  { key: 'share', label: 'Share', align: 'right', sortable: true },
]

export default async function AppPerformancePage({
  searchParams,
}: {
  searchParams: { range?: string }
}) {
  const data = await getAppPerformanceData(searchParams)
  const rangeLabel = RANGE_LABELS[searchParams?.range ?? '30d'] ?? 'Last 30 Days'

  const funnelBars: BarChartDataPoint[] = data.onboardingFunnel.map((s) => ({ label: s.label, value: s.value }))
  const featureUsageBars: BarChartDataPoint[] = data.featureUsage.map((r) => ({ label: r.feature, value: r.clicks }))
  const recentActivityRows = data.recentActivity.map((row) => ({
    eventName: row.eventName,
    eventCount: formatNumber(row.eventCount),
    users: formatNumber(row.users),
  }))

  const toolBars: BarChartDataPoint[] = data.toolStats.map((t) => ({ label: t.tool, value: t.users }))
  const toolTrendData: AreaChartDataPoint[] = data.toolTrend.map((d) => ({
    date: formatTrendDate(d.date),
    value: d.events,
    secondaryValue: d.users,
  }))
  const totalToolUsers = data.toolStats.reduce((s, t) => s + t.users, 0) || 1
  const toolRows = data.toolStats.map((t) => ({
    tool: t.tool,
    users: formatNumber(t.users),
    events: formatNumber(t.events),
    platform: `${formatNumber(t.android)} / ${formatNumber(t.ios)} / ${formatNumber(t.web)}`,
    share: formatPercent((t.users / totalToolUsers) * 100),
  }))

  const notLive: string[] = []
  if (!data.hasEvents) notLive.push('No GA4 app events for this period — figures may be incomplete.')
  if (!data.installsSourced) notLive.push('Total Installs uses the GA4 first_open proxy — the Play Store install count is not synced.')
  if (!data.ratingsSourced) notLive.push('Store ratings are not synced yet.')
  if (data.ratingsSourced && !data.starBreakdownAvailable) notLive.push('Rating star breakdown is not provided by the Play Store listing (shows blanks).')
  notLive.push('App Store is not connected (needs App Store Connect / the Russian storefront) — its card shows “Not connected”.')
  if (!data.activeUsersSourced) notLive.push('Active Users falls back to session users (the GA4 app active-users metric is unavailable).')

  return (
    <div>
      <Header title="App Performance" />

      {notLive.length > 0 && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-800">Some data isn&apos;t fully connected</p>
          <ul className="mt-1 list-disc pl-5 text-xs text-amber-700">
            {notLive.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}

      {/* KPI cards row */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <KPICard
          title={data.installsLifetime ? 'Total Installs (lifetime)' : 'New Installs (period)'}
          value={formatNumber(data.totalInstalls.value)}
          change={data.totalInstalls.change ?? undefined}
          trend={getTrend(data.totalInstalls.change)}
          iconName="smartphone"
          tooltip={
            data.installsLifetime
              ? 'Cumulative installs from the Play Store listing (latest snapshot — an approximate badge like 100,000+, not summed). App Store not included.'
              : 'New installs this period, proxied by GA4 first_open (Play Store install count not synced).'
          }
        />
        <KPICard
          title="Active Users"
          value={formatNumber(data.activeUsers.value)}
          change={data.activeUsers.change ?? undefined}
          trend={getTrend(data.activeUsers.change)}
          iconName="users"
          tooltip="De-duplicated active users of the Sahal Wallet app for this period (GA4 app property)."
        />
        <KPICard
          title="Avg Rating"
          value={data.ratingsSourced ? data.avgRating.value.toFixed(1) : '—'}
          change={data.avgRating.change ?? undefined}
          trend={getTrend(data.avgRating.change)}
          iconName="trending-up"
          tooltip="Average Play Store star rating (out of 5). App Store not connected."
        />
        <KPICard
          title="Onboarding Rate"
          value={formatPercent(data.onboardingRate.value)}
          change={data.onboardingRate.change ?? undefined}
          trend={getTrend(data.onboardingRate.change)}
          iconName="filter"
          tooltip="Onboarding completions vs new installs (approx.): users completing *_ONBOARDING_GUIDE_COMPLETE ÷ first_open."
        />
        <KPICard
          title="Transaction Rate"
          value={formatPercent(data.transactionRate.value)}
          change={data.transactionRate.change ?? undefined}
          trend={getTrend(data.transactionRate.change)}
          iconName="dollar-sign"
          tooltip="Transacting users ÷ users reaching the dashboard (send / swap / ramp events, all platforms)."
        />
      </div>

      {/* Install / active users trend */}
      <div className="mb-6">
        <AreaChart
          data={data.usageTrend}
          title="New Installs vs. Active Users (daily)"
          color="#01A6FA"
          fillColor="#D0EFFF"
          seriesLabel="New Installs (first_open)"
          secondarySeriesLabel="Active Users (daily)"
          secondaryColor="#E5B897"
          height={320}
        />
      </div>

      {/* Tool Usage — per in-app tool engagement */}
      {data.toolStats.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-1 text-lg font-semibold text-mrhb-dark">
            Tool Usage <span className="text-xs font-normal text-mrhb-dark/40">&middot; {rangeLabel}</span>
          </h2>
          <p className="mb-4 text-xs text-mrhb-dark/50">
            Engagement per in-app tool (GA4 app events, all platforms). &ldquo;Active Users&rdquo; is summed daily
            active (a ceiling, not unique-in-period); each event counts once toward its first-matching tool. The
            tool&rarr;event mapping is editable in Admin.
          </p>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <BarChart
              data={toolBars}
              title="Active Users by Tool"
              color="#01A6FA"
              valueLabel="Active Users"
              height={360}
              layout="horizontal"
            />
            <AreaChart
              data={toolTrendData}
              title="Daily Tool Engagement"
              color="#01A6FA"
              fillColor="#D0EFFF"
              seriesLabel="Events"
              secondarySeriesLabel="Active Users"
              secondaryColor="#E5B897"
              height={360}
            />
          </div>
          <div className="mt-4">
            <DataTable
              columns={TOOL_USAGE_COLUMNS}
              data={toolRows}
              title="Tool Usage Detail"
              emptyMessage="No tool usage for this period."
            />
          </div>
        </div>
      )}

      {/* Onboarding funnel */}
      <div className="mb-6">
        <BarChart data={funnelBars} title="App Activity by Stage" color="#01A6FA" height={300} layout="vertical" />
        <p className="mt-2 text-xs text-mrhb-dark/50">
          App-wide activity in this period (unique users per stage), not a single install cohort — later stages
          count your whole active base, so they can exceed new installs. &ldquo;Onboarding Complete&rdquo; is
          matched across Android/iOS/web (*_ONBOARDING_GUIDE_COMPLETE).
        </p>
      </div>

      {/* Ratings */}
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          {data.starBreakdownAvailable ? (
            <>
              <BarChart data={data.ratingDistribution} title="Rating Distribution" color="#E5B897" height={280} layout="horizontal" />
              {data.starBreakdownFromSample && (
                <p className="mt-2 text-xs text-mrhb-dark/50">
                  Based on the {formatNumber(data.reviewsSampledCount)} most recent reviews (Android Publisher API) — a
                  sample, not the full all-time histogram. The headline average uses the store-listing aggregate.
                </p>
              )}
            </>
          ) : (
            <div className="flex h-full min-h-[200px] flex-col justify-center rounded-xl bg-mrhb-white p-5 shadow-sm">
              <h3 className="mb-2 text-base font-semibold text-mrhb-dark">Rating Distribution</h3>
              <p className="text-sm text-mrhb-dark/50">
                A star-by-star breakdown isn&apos;t available yet (no recent reviews returned). The average rating and
                review count above are live.
              </p>
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {data.storeRatings.map((store) => (
            <div
              key={store.store}
              className={`rounded-xl p-5 shadow-sm ${store.connected ? 'bg-mrhb-white' : 'border border-dashed border-mrhb-warm-grey/50 bg-mrhb-cream/40'}`}
            >
              <p className="text-sm font-medium text-mrhb-dark/60">{store.store}</p>
              {store.connected ? (
                <>
                  <div className="mt-2 flex items-baseline gap-2">
                    <p className="text-2xl font-semibold text-mrhb-dark">{store.avgRating.toFixed(1)}</p>
                    <span className="text-mrhb-warm-tan">★</span>
                  </div>
                  <p className="mt-1 text-xs text-mrhb-dark/50">{formatNumber(store.reviewsCount)} reviews</p>
                </>
              ) : (
                <div className="mt-2">
                  <span className="inline-flex items-center rounded-full bg-mrhb-warm-grey/20 px-2.5 py-1 text-[11px] font-semibold text-mrhb-dark/50">
                    Not connected
                  </span>
                  <p className="mt-2 text-xs text-mrhb-dark/50">Needs App Store Connect (Russian storefront).</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Recent reviews (Play Store, Android Publisher API) */}
      {data.recentReviews.length > 0 && (
        <div className="mb-6 rounded-xl bg-mrhb-white p-5 shadow-sm">
          <h3 className="mb-4 text-base font-semibold text-mrhb-dark">
            Recent Reviews <span className="text-xs font-normal text-mrhb-dark/40">&middot; Play Store</span>
          </h3>
          <ul className="space-y-3">
            {data.recentReviews.slice(0, 8).map((rv, i) => (
              <li key={`${rv.author}-${rv.date}-${i}`} className="rounded-lg border border-mrhb-warm-grey/15 p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm font-medium text-mrhb-dark">{rv.author}</span>
                  <span className="flex-shrink-0 text-sm">
                    <span className="text-mrhb-warm-tan">{'★'.repeat(rv.rating)}</span>
                    <span className="text-mrhb-warm-grey/40">{'★'.repeat(Math.max(0, 5 - rv.rating))}</span>
                  </span>
                </div>
                {rv.text && <p className="mt-1 text-xs leading-snug text-mrhb-dark/70">{rv.text}</p>}
                <p className="mt-1 text-[11px] text-mrhb-dark/40">
                  {[rv.date, rv.version ? `v${rv.version}` : null, rv.device].filter(Boolean).join(' · ')}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Feature usage — tile click events */}
      {featureUsageBars.length > 0 && (
        <div className="mb-6">
          <BarChart data={featureUsageBars} title="Feature Usage (Tile Clicks)" color="#01A6FA" height={320} layout="vertical" />
        </div>
      )}

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
