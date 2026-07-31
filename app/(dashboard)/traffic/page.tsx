import Header from '@/components/layout/Header'
import KPICard from '@/components/cards/KPICard'
import AreaChart, { type AreaChartDataPoint } from '@/components/charts/AreaChart'
import DonutChart, { type DonutChartDataPoint } from '@/components/charts/DonutChart'
import BarChart, { type BarChartDataPoint } from '@/components/charts/BarChart'
import DataTable, { type DataTableColumn } from '@/components/tables/DataTable'
import { formatNumber, formatPercent, formatDuration } from '@/lib/utils/format'
import { createServiceClient } from '@/lib/supabase/server'
import { getDateWindow } from '@/lib/utils/date-range'

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------
// Server Component.
//
// KPI cards read AUTHORITATIVE per-range totals from `daily_kpis` (written by
// ingestion via lib/api-clients/ga4-range-kpis). This is deliberate: GA4's
// user metrics are de-duplicated and NOT additive, so the previous approach of
// SUMMING `ga_traffic` rows over-counted users (it produced Users > Sessions).
// The daily_kpis rows hold GA4's de-duplicated totals per range plus a correct
// prior-period % change (so 90d no longer shows a bogus 100%).
//
// Trend / channel / source / geo breakdowns still come from `ga_traffic` +
// `ga_geo`, bounded to the selected window on BOTH ends. Because GA4 finalizes
// data on a 1-2 day delay, very recent ranges (today/yesterday) can have live
// KPI totals but no per-row breakdown yet — the page shows a clear notice
// instead of silently rendering sample data.

interface SourceRow {
  source: string
  medium: string
  sessions: number
  users: number
  bounceRate: number
}

interface BrowserOsRow {
  browser: string
  os: string
  sessions: number
  users: number
  avgSessionDuration: number
}

interface TrafficData {
  sessions: { value: number; change: number }
  users: { value: number; change: number }
  newUsers: { value: number; change: number }
  bounceRate: { value: number; change: number }
  avgSessionDuration: { value: number; change: number }
  sessionsUsersTrend: AreaChartDataPoint[]
  channelBreakdown: DonutChartDataPoint[]
  topSources: SourceRow[]
  deviceBreakdown: DonutChartDataPoint[]
  topCountries: BarChartDataPoint[]
  browserOsBreakdown: BrowserOsRow[]
  /** True when authoritative KPI totals (daily_kpis) are available for the range. */
  kpisSourced: boolean
  /** True when per-row ga_traffic breakdown data exists for the window. */
  breakdownSourced: boolean
}

// 30 daily points, roughly trending up with weekend dips — realistic for a
// halal fintech app with ~50K monthly active users (~1,600-1,900 sessions/day).
function buildSessionsUsersTrend(): AreaChartDataPoint[] {
  const dates = [
    'Jun 24', 'Jun 25', 'Jun 26', 'Jun 27', 'Jun 28', 'Jun 29', 'Jun 30',
    'Jul 01', 'Jul 02', 'Jul 03', 'Jul 04', 'Jul 05', 'Jul 06', 'Jul 07',
    'Jul 08', 'Jul 09', 'Jul 10', 'Jul 11', 'Jul 12', 'Jul 13', 'Jul 14',
    'Jul 15', 'Jul 16', 'Jul 17', 'Jul 18', 'Jul 19', 'Jul 20', 'Jul 21',
    'Jul 22', 'Jul 23',
  ]
  const sessions = [
    1620, 1710, 1685, 1590, 1420, 1380, 1450,
    1780, 1820, 1795, 1690, 1540, 1490, 1560,
    1910, 1960, 1885, 1820, 1650, 1600, 1670,
    2040, 2110, 2085, 1990, 1780, 1720, 1830,
    2180, 2260,
  ]
  const users = [
    1180, 1240, 1225, 1160, 1050, 1010, 1060,
    1290, 1320, 1305, 1230, 1120, 1080, 1130,
    1380, 1410, 1365, 1320, 1210, 1170, 1220,
    1470, 1520, 1500, 1440, 1290, 1250, 1330,
    1560, 1620,
  ]

  return dates.map((date, i) => ({
    date,
    value: sessions[i],
    secondaryValue: users[i],
  }))
}

const MOCK_TRAFFIC: TrafficData = {
  sessions: { value: 52840, change: 9.8 },
  users: { value: 38215, change: 7.2 },
  newUsers: { value: 21460, change: 11.4 },
  bounceRate: { value: 41.2, change: -2.6 },
  avgSessionDuration: { value: 187, change: 5.1 },
  sessionsUsersTrend: buildSessionsUsersTrend(),
  channelBreakdown: [
    { name: 'Organic Search', value: 21875 },
    { name: 'Social', value: 13210 },
    { name: 'Direct', value: 9640 },
    { name: 'Referral', value: 5120 },
    { name: 'Paid', value: 2995 },
  ],
  topSources: [
    { source: 'google', medium: 'organic', sessions: 19840, users: 14320, bounceRate: 38.4 },
    { source: 'instagram', medium: 'social', sessions: 7910, users: 5860, bounceRate: 52.1 },
    { source: '(direct)', medium: '(none)', sessions: 9640, users: 7215, bounceRate: 33.6 },
    { source: 'twitter', medium: 'social', sessions: 3480, users: 2540, bounceRate: 49.8 },
    { source: 'facebook', medium: 'social', sessions: 1820, users: 1390, bounceRate: 55.3 },
    { source: 'mrhbnetwork.short.gy', medium: 'referral', sessions: 2610, users: 1980, bounceRate: 44.2 },
    { source: 'linkedin', medium: 'social', sessions: 1690, users: 1240, bounceRate: 46.7 },
    { source: 'bing', medium: 'organic', sessions: 2035, users: 1610, bounceRate: 40.9 },
    { source: 'google-ads', medium: 'cpc', sessions: 2995, users: 2180, bounceRate: 47.5 },
    { source: 'islamicfinanceguru.com', medium: 'referral', sessions: 1310, users: 985, bounceRate: 36.2 },
  ],
  deviceBreakdown: [
    { name: 'Mobile', value: 37460, color: '#01A6FA' },
    { name: 'Desktop', value: 13120, color: '#29231D' },
    { name: 'Tablet', value: 2260, color: '#E5B897' },
  ],
  topCountries: [
    { label: 'United Arab Emirates', value: 16920 },
    { label: 'Saudi Arabia', value: 12180 },
    { label: 'United Kingdom', value: 6540 },
    { label: 'United States', value: 5310 },
    { label: 'Malaysia', value: 3680 },
    { label: 'Pakistan', value: 2740 },
    { label: 'Indonesia', value: 2190 },
    { label: 'Qatar', value: 1620 },
    { label: 'Kuwait', value: 1180 },
    { label: 'Egypt', value: 960 },
  ],
  browserOsBreakdown: [
    { browser: 'Chrome', os: 'Android', sessions: 22140, users: 15680, avgSessionDuration: 172 },
    { browser: 'Safari', os: 'iOS', sessions: 14380, users: 10420, avgSessionDuration: 205 },
    { browser: 'Chrome', os: 'Windows', sessions: 7210, users: 5340, avgSessionDuration: 196 },
    { browser: 'Safari', os: 'macOS', sessions: 3960, users: 2890, avgSessionDuration: 224 },
    { browser: 'Samsung Internet', os: 'Android', sessions: 2480, users: 1840, avgSessionDuration: 158 },
    { browser: 'Edge', os: 'Windows', sessions: 1610, users: 1210, avgSessionDuration: 181 },
    { browser: 'Firefox', os: 'Windows', sessions: 690, users: 520, avgSessionDuration: 190 },
    { browser: 'Chrome', os: 'macOS', sessions: 370, users: 275, avgSessionDuration: 211 },
  ],
  kpisSourced: false,
  breakdownSourced: false,
}

/** Formats a `YYYY-MM-DD` string as "Jul 23" to match the mock trend labels. */
function formatShortDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', timeZone: 'UTC' })
}

interface GATrafficWindowRow {
  date: string
  sessions: number
  users: number
  new_users: number
  bounce_rate: number
  avg_session_duration: number
  channel: string
  source: string
  medium: string
}

interface GAGeoWindowRow {
  country: string
  users: number
  sessions: number
  device_category: string
  browser: string | null
  os: string | null
}

interface DailyKpiRow {
  date: string
  metric_name: string
  metric_value: number
  period_comparison_pct: number | null
}

/** The five metric suffixes stored per range in daily_kpis. */
const KPI_METRICS = ['sessions', 'users', 'new_users', 'bounce_rate', 'avg_session_duration'] as const

async function getTrafficData(searchParams?: { range?: string }): Promise<TrafficData> {
  try {
    const supabase = createServiceClient()
    const rangeKey = searchParams?.range ?? '30d'
    const { startDate, endDate } = getDateWindow(searchParams)

    // Authoritative KPI snapshot is written each sync (dated the run day);
    // read the most recent one within a small cutoff.
    const snapshotCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const kpiMetricNames = KPI_METRICS.map((m) => `traffic_${m}_${rangeKey}`)

    const [kpiResult, trafficResult, geoResult] = await Promise.all([
      supabase
        .from('daily_kpis')
        .select('date, metric_name, metric_value, period_comparison_pct')
        .eq('source', 'ga4')
        .in('metric_name', kpiMetricNames)
        .gte('date', snapshotCutoff),
      supabase
        .from('ga_traffic')
        .select('date, sessions, users, new_users, bounce_rate, avg_session_duration, channel, source, medium')
        .gte('date', startDate)
        .lte('date', endDate)
        // Website-only, to match the website-property KPI cards and GA4's own
        // website report. Ingestion tags website rows with campaign=null and
        // Sahal Wallet app rows with campaign='(not set)', so this cleanly
        // excludes app traffic (which belongs to the App Performance page).
        .is('campaign', null)
        .order('date', { ascending: true }),
      supabase
        .from('ga_geo')
        .select('date, country, users, sessions, device_category, browser, os')
        .gte('date', startDate)
        .lte('date', endDate),
    ])

    // --- Authoritative KPIs from daily_kpis (latest snapshot) ---
    const kpiRows = (!kpiResult.error && kpiResult.data ? (kpiResult.data as DailyKpiRow[]) : [])
    const latestKpiDate = kpiRows.reduce((max, r) => (r.date > max ? r.date : max), '')
    const latestKpiRows = kpiRows.filter((r) => r.date === latestKpiDate)
    const kpiByMetric = new Map(latestKpiRows.map((r) => [r.metric_name, r]))
    const kpisSourced = latestKpiRows.length > 0

    const readKpi = (metric: string): { value: number; change: number } => {
      const row = kpiByMetric.get(`traffic_${metric}_${rangeKey}`)
      return { value: row?.metric_value ?? 0, change: row?.period_comparison_pct ?? 0 }
    }

    const trafficRows = (!trafficResult.error && trafficResult.data
      ? (trafficResult.data as GATrafficWindowRow[])
      : []
    ).filter((r) => r.date)
    const geoRows = !geoResult.error && geoResult.data ? (geoResult.data as GAGeoWindowRow[]) : []
    const breakdownSourced = trafficRows.length > 0

    // Nothing available at all — fall back to the full sample payload.
    if (!kpisSourced && !breakdownSourced) {
      return { ...MOCK_TRAFFIC, kpisSourced: false, breakdownSourced: false }
    }

    // KPI cards: authoritative daily_kpis when present; otherwise (rare) derive
    // from the window rows. NOTE: summing users is only a degraded fallback —
    // the authoritative path is the correct, de-duplicated one.
    let sessions: { value: number; change: number }
    let users: { value: number; change: number }
    let newUsers: { value: number; change: number }
    let bounceRate: { value: number; change: number }
    let avgSessionDuration: { value: number; change: number }

    if (kpisSourced) {
      sessions = readKpi('sessions')
      users = readKpi('users')
      newUsers = readKpi('new_users')
      bounceRate = readKpi('bounce_rate')
      avgSessionDuration = readKpi('avg_session_duration')
    } else {
      const sum = (key: 'sessions' | 'users' | 'new_users') =>
        trafficRows.reduce((total, row) => total + (row[key] ?? 0), 0)
      const avg = (key: 'bounce_rate' | 'avg_session_duration') =>
        trafficRows.length > 0 ? trafficRows.reduce((t, r) => t + (r[key] ?? 0), 0) / trafficRows.length : 0
      sessions = { value: sum('sessions'), change: 0 }
      users = { value: sum('users'), change: 0 }
      newUsers = { value: sum('new_users'), change: 0 }
      bounceRate = { value: avg('bounce_rate'), change: 0 }
      avgSessionDuration = { value: avg('avg_session_duration'), change: 0 }
    }

    // --- Trend / channel / sources from the bounded ga_traffic window rows ---
    const trendByDate = new Map<string, { sessions: number; users: number }>()
    for (const row of trafficRows) {
      const entry = trendByDate.get(row.date) ?? { sessions: 0, users: 0 }
      entry.sessions += row.sessions ?? 0
      entry.users += row.users ?? 0
      trendByDate.set(row.date, entry)
    }
    const sessionsUsersTrend: AreaChartDataPoint[] = Array.from(trendByDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, { sessions: s, users: u }]) => ({
        date: formatShortDate(date),
        value: s,
        secondaryValue: u,
      }))

    const channelTotals = new Map<string, number>()
    for (const row of trafficRows) {
      channelTotals.set(row.channel, (channelTotals.get(row.channel) ?? 0) + (row.sessions ?? 0))
    }
    const channelBreakdown: DonutChartDataPoint[] = Array.from(channelTotals.entries())
      .sort(([, a], [, b]) => b - a)
      .map(([name, value]) => ({ name, value }))

    const sourceAgg = new Map<string, { sessions: number; users: number; bounceSum: number; count: number }>()
    for (const row of trafficRows) {
      const key = `${row.source}\u0000${row.medium}`
      const entry = sourceAgg.get(key) ?? { sessions: 0, users: 0, bounceSum: 0, count: 0 }
      entry.sessions += row.sessions ?? 0
      entry.users += row.users ?? 0
      entry.bounceSum += row.bounce_rate ?? 0
      entry.count += 1
      sourceAgg.set(key, entry)
    }
    const topSources: SourceRow[] = Array.from(sourceAgg.entries())
      .map(([key, agg]) => {
        const [source, medium] = key.split('\u0000')
        return {
          source,
          medium,
          sessions: agg.sessions,
          users: agg.users,
          bounceRate: agg.count > 0 ? agg.bounceSum / agg.count : 0,
        }
      })
      .sort((a, b) => b.sessions - a.sessions)
      .slice(0, 10)

    // --- Device / country / browser+OS from ga_geo window rows ---
    let deviceBreakdown: DonutChartDataPoint[] = []
    let topCountries: BarChartDataPoint[] = []
    let browserOsBreakdown: BrowserOsRow[] = []

    if (geoRows.length > 0) {
      const deviceTotals = new Map<string, number>()
      const countryTotals = new Map<string, number>()
      const browserOsAgg = new Map<string, { sessions: number; users: number }>()

      for (const row of geoRows) {
        deviceTotals.set(row.device_category, (deviceTotals.get(row.device_category) ?? 0) + (row.users ?? 0))
        countryTotals.set(row.country, (countryTotals.get(row.country) ?? 0) + (row.users ?? 0))

        const browser = row.browser ?? 'Unknown'
        const os = row.os ?? 'Unknown'
        const key = `${browser}\u0000${os}`
        const entry = browserOsAgg.get(key) ?? { sessions: 0, users: 0 }
        entry.sessions += row.sessions ?? 0
        entry.users += row.users ?? 0
        browserOsAgg.set(key, entry)
      }

      deviceBreakdown = Array.from(deviceTotals.entries())
        .sort(([, a], [, b]) => b - a)
        .map(([name, value]) => ({ name, value }))

      topCountries = Array.from(countryTotals.entries())
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([label, value]) => ({ label, value }))

      browserOsBreakdown = Array.from(browserOsAgg.entries())
        .map(([key, agg]) => {
          const [browser, os] = key.split('\u0000')
          return {
            browser,
            os,
            sessions: agg.sessions,
            users: agg.users,
            // avg_session_duration isn't tracked per geo/device slice, so the
            // window-level average is used as a reasonable per-row estimate.
            avgSessionDuration: avgSessionDuration.value,
          }
        })
        .sort((a, b) => b.sessions - a.sessions)
        .slice(0, 10)
    }

    return {
      sessions,
      users,
      newUsers,
      bounceRate,
      avgSessionDuration,
      sessionsUsersTrend,
      channelBreakdown,
      topSources,
      deviceBreakdown,
      topCountries,
      browserOsBreakdown,
      kpisSourced,
      breakdownSourced,
    }
  } catch {
    // Network failure, missing env vars, or any other unexpected error —
    // the UI must always render, so fall all the way back to sample data.
    return { ...MOCK_TRAFFIC, kpisSourced: false, breakdownSourced: false }
  }
}

function getTrend(change: number): 'up' | 'down' | 'flat' {
  if (change > 0) return 'up'
  if (change < 0) return 'down'
  return 'flat'
}

const sourceColumns: DataTableColumn[] = [
  { key: 'source', label: 'Source', sortable: true },
  { key: 'medium', label: 'Medium', sortable: true },
  { key: 'sessions', label: 'Sessions', sortable: true, align: 'right' },
  { key: 'users', label: 'Users', sortable: true, align: 'right' },
  { key: 'bounceRate', label: 'Bounce Rate', sortable: true, align: 'right' },
]

const browserOsColumns: DataTableColumn[] = [
  { key: 'browser', label: 'Browser', sortable: true },
  { key: 'os', label: 'OS', sortable: true },
  { key: 'sessions', label: 'Sessions', sortable: true, align: 'right' },
  { key: 'users', label: 'Users', sortable: true, align: 'right' },
  { key: 'avgSessionDuration', label: 'Avg Session', sortable: true, align: 'right' },
]

const RANGE_LABELS: Record<string, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  '7d': 'Last 7 Days',
  '30d': 'Last 30 Days',
  '90d': 'Last 90 Days',
}

export default async function TrafficPage({
  searchParams,
}: {
  searchParams: { range?: string }
}) {
  const data = await getTrafficData(searchParams)
  const rangeLabel = RANGE_LABELS[searchParams?.range ?? '30d'] ?? 'Last 30 Days'

  const sourceRows = data.topSources.map((row) => ({
    source: row.source,
    medium: row.medium,
    sessions: formatNumber(row.sessions),
    users: formatNumber(row.users),
    bounceRate: formatPercent(row.bounceRate),
  }))

  const browserOsRows = data.browserOsBreakdown.map((row) => ({
    browser: row.browser,
    os: row.os,
    sessions: formatNumber(row.sessions),
    users: formatNumber(row.users),
    avgSessionDuration: formatDuration(row.avgSessionDuration),
  }))

  return (
    <div>
      <Header title="Traffic & Acquisition" />

      {/* Data-state notices — never present sample data as live */}
      {!data.kpisSourced && !data.breakdownSourced && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-800">Showing sample data</p>
          <p className="mt-1 text-xs text-amber-700">
            Live GA4 metrics are unavailable for this period. The figures below are
            representative sample values, not sourced analytics. Run a sync to populate live data.
          </p>
        </div>
      )}
      {data.kpisSourced && !data.breakdownSourced && (
        <div className="mb-6 rounded-lg border border-mrhb-blue-light bg-mrhb-blue-light/30 p-4">
          <p className="text-sm font-medium text-mrhb-dark">Headline totals are live for this range.</p>
          <p className="mt-1 text-xs text-mrhb-dark/60">
            GA4 finalizes detailed data on a 1&ndash;2 day delay, so the trend, channel, source,
            geography, and device breakdowns below aren&rsquo;t available for {rangeLabel} yet.
          </p>
        </div>
      )}

      {/* KPI cards row — pass iconName strings, not components */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <KPICard
          title="Sessions"
          value={formatNumber(data.sessions.value)}
          change={data.sessions.change}
          trend={getTrend(data.sessions.change)}
          iconName="mouse-pointer-click"
          tooltip="Total visits to your website. One person can have multiple sessions"
        />
        <KPICard
          title="Users"
          value={formatNumber(data.users.value)}
          change={data.users.change}
          trend={getTrend(data.users.change)}
          iconName="users"
          tooltip="Unique people who visited your website (de-duplicated by GA4)"
        />
        <KPICard
          title="New Users"
          value={formatNumber(data.newUsers.value)}
          change={data.newUsers.change}
          trend={getTrend(data.newUsers.change)}
          iconName="trending-up"
          tooltip="First-time visitors who never visited your site before"
        />
        <KPICard
          title="Bounce Rate"
          value={formatPercent(data.bounceRate.value)}
          change={data.bounceRate.change}
          trend={getTrend(-data.bounceRate.change)}
          iconName="filter"
          tooltip="Percentage of visitors who left after viewing only one page. Lower is better"
        />
        <KPICard
          title="Avg Session Duration"
          value={formatDuration(data.avgSessionDuration.value)}
          change={data.avgSessionDuration.change}
          trend={getTrend(data.avgSessionDuration.change)}
          iconName="globe"
          tooltip="Average time a visitor spends on your website per visit"
        />
      </div>

      {/* Sessions & Users trend */}
      <div className="mb-6">
        <AreaChart
          data={data.sessionsUsersTrend}
          title={`Sessions & Users (${rangeLabel})`}
          color="#01A6FA"
          secondaryColor="#E5B897"
          seriesLabel="Sessions"
          secondarySeriesLabel="Users"
          height={320}
        />
      </div>

      {/* Channel breakdown + source/medium table */}
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <DonutChart
          data={data.channelBreakdown}
          title="Channel Breakdown"
          height={300}
        />
        <DataTable
          columns={sourceColumns}
          data={sourceRows}
          title="Top Sources / Medium"
          emptyMessage="No source data available for this period."
        />
      </div>

      {/* Device + top countries */}
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <DonutChart
          data={data.deviceBreakdown}
          title="Device Category"
          height={280}
        />
        <BarChart
          data={data.topCountries}
          title="Top Countries"
          color="#01A6FA"
          height={320}
          layout="horizontal"
        />
      </div>

      {/* Browser / OS breakdown */}
      <DataTable
        columns={browserOsColumns}
        data={browserOsRows}
        title="Browser & OS Breakdown"
        emptyMessage="No browser/OS data available for this period."
      />
    </div>
  )
}
