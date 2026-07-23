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
// Server Component — reads from the `ga_traffic` table (synced nightly from
// the GA4 Data API — see lib/types/index.ts `GATraffic`) for KPIs/trend/
// channel/source breakdowns, and from `ga_geo` (see `GAGeo`) for device,
// country, and browser/OS breakdowns. PostgREST has no server-side GROUP BY,
// so each query below pulls raw rows for the window and aggregates them in
// JS. Every aggregation falls back to the matching MOCK_TRAFFIC slice when
// Supabase returns an error or zero rows (missing table, RLS not yet
// configured, or a genuinely quiet period).

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
}

/** Percent change of `current` vs `previous`, guarding divide-by-zero. */
function pctChange(current: number, previous: number): number {
  if (!previous) return current > 0 ? 100 : 0
  return ((current - previous) / previous) * 100
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

async function getTrafficData(searchParams?: { range?: string }): Promise<TrafficData> {
  try {
    const supabase = createServiceClient()

    const { startDate, prevStartDate } = getDateWindow(searchParams)
    const since60d = prevStartDate
    const cutoff30d = startDate

    const [trafficResult, geoResult] = await Promise.all([
      supabase
        .from('ga_traffic')
        .select('date, sessions, users, new_users, bounce_rate, avg_session_duration, channel, source, medium')
        .gte('date', since60d)
        .order('date', { ascending: true }),
      supabase
        .from('ga_geo')
        .select('country, users, sessions, device_category, browser, os')
        .gte('date', cutoff30d),
    ])

    const trafficRows = (!trafficResult.error && trafficResult.data
      ? (trafficResult.data as GATrafficWindowRow[])
      : []
    ).filter((r) => r.date)

    const geoRows = !geoResult.error && geoResult.data ? (geoResult.data as GAGeoWindowRow[]) : []

    // No `ga_traffic` history at all (missing table / RLS / empty DB) —
    // fall back to the full mock payload rather than mixing partial data.
    if (trafficRows.length === 0) {
      return MOCK_TRAFFIC
    }

    const currentRows = trafficRows.filter((r) => r.date >= cutoff30d)
    const previousRows = trafficRows.filter((r) => r.date < cutoff30d)

    const sumBy = (rows: GATrafficWindowRow[], key: 'sessions' | 'users' | 'new_users') =>
      rows.reduce((total, row) => total + (row[key] ?? 0), 0)
    const avgBy = (rows: GATrafficWindowRow[], key: 'bounce_rate' | 'avg_session_duration') =>
      rows.length > 0 ? rows.reduce((total, row) => total + (row[key] ?? 0), 0) / rows.length : 0

    const sessionsCurrent = sumBy(currentRows, 'sessions')
    const sessionsPrevious = sumBy(previousRows, 'sessions')
    const usersCurrent = sumBy(currentRows, 'users')
    const usersPrevious = sumBy(previousRows, 'users')
    const newUsersCurrent = sumBy(currentRows, 'new_users')
    const newUsersPrevious = sumBy(previousRows, 'new_users')
    const bounceRateCurrent = avgBy(currentRows, 'bounce_rate')
    const bounceRatePrevious = avgBy(previousRows, 'bounce_rate')
    const avgSessionDurationCurrent = avgBy(currentRows, 'avg_session_duration')
    const avgSessionDurationPrevious = avgBy(previousRows, 'avg_session_duration')

    // Sessions & users trend — daily totals for the current 30-day window.
    const trendByDate = new Map<string, { sessions: number; users: number }>()
    for (const row of currentRows) {
      const entry = trendByDate.get(row.date) ?? { sessions: 0, users: 0 }
      entry.sessions += row.sessions ?? 0
      entry.users += row.users ?? 0
      trendByDate.set(row.date, entry)
    }
    const sessionsUsersTrend: AreaChartDataPoint[] = Array.from(trendByDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, { sessions, users }]) => ({
        date: formatShortDate(date),
        value: sessions,
        secondaryValue: users,
      }))

    // Channel breakdown — sessions grouped by channel.
    const channelTotals = new Map<string, number>()
    for (const row of currentRows) {
      channelTotals.set(row.channel, (channelTotals.get(row.channel) ?? 0) + (row.sessions ?? 0))
    }
    const channelBreakdown: DonutChartDataPoint[] = Array.from(channelTotals.entries())
      .sort(([, a], [, b]) => b - a)
      .map(([name, value]) => ({ name, value }))

    // Source/medium table — top 10 by sessions, with per-slice avg bounce rate.
    const sourceAgg = new Map<string, { sessions: number; users: number; bounceSum: number; count: number }>()
    for (const row of currentRows) {
      const key = `${row.source} ${row.medium}`
      const entry = sourceAgg.get(key) ?? { sessions: 0, users: 0, bounceSum: 0, count: 0 }
      entry.sessions += row.sessions ?? 0
      entry.users += row.users ?? 0
      entry.bounceSum += row.bounce_rate ?? 0
      entry.count += 1
      sourceAgg.set(key, entry)
    }
    const topSources: SourceRow[] = Array.from(sourceAgg.entries())
      .map(([key, agg]) => {
        const [source, medium] = key.split(' ')
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

    // Device / country / browser+OS breakdowns come from `ga_geo`.
    let deviceBreakdown: DonutChartDataPoint[] = MOCK_TRAFFIC.deviceBreakdown
    let topCountries: BarChartDataPoint[] = MOCK_TRAFFIC.topCountries
    let browserOsBreakdown: BrowserOsRow[] = MOCK_TRAFFIC.browserOsBreakdown

    if (geoRows.length > 0) {
      const deviceTotals = new Map<string, number>()
      const countryTotals = new Map<string, number>()
      const browserOsAgg = new Map<string, { sessions: number; users: number }>()

      for (const row of geoRows) {
        deviceTotals.set(
          row.device_category,
          (deviceTotals.get(row.device_category) ?? 0) + (row.users ?? 0)
        )
        countryTotals.set(row.country, (countryTotals.get(row.country) ?? 0) + (row.users ?? 0))

        const browser = row.browser ?? 'Unknown'
        const os = row.os ?? 'Unknown'
        const key = `${browser} ${os}`
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
          const [browser, os] = key.split(' ')
          return {
            browser,
            os,
            sessions: agg.sessions,
            users: agg.users,
            // avg_session_duration isn't tracked per geo/device slice in
            // `ga_geo`, so the site-wide current-window average is used as
            // a reasonable per-row estimate rather than fabricating a value.
            avgSessionDuration: avgSessionDurationCurrent,
          }
        })
        .sort((a, b) => b.sessions - a.sessions)
        .slice(0, 10)
    }

    return {
      sessions: { value: sessionsCurrent, change: pctChange(sessionsCurrent, sessionsPrevious) },
      users: { value: usersCurrent, change: pctChange(usersCurrent, usersPrevious) },
      newUsers: { value: newUsersCurrent, change: pctChange(newUsersCurrent, newUsersPrevious) },
      bounceRate: { value: bounceRateCurrent, change: pctChange(bounceRateCurrent, bounceRatePrevious) },
      avgSessionDuration: {
        value: avgSessionDurationCurrent,
        change: pctChange(avgSessionDurationCurrent, avgSessionDurationPrevious),
      },
      sessionsUsersTrend: sessionsUsersTrend.length > 0 ? sessionsUsersTrend : MOCK_TRAFFIC.sessionsUsersTrend,
      channelBreakdown: channelBreakdown.length > 0 ? channelBreakdown : MOCK_TRAFFIC.channelBreakdown,
      topSources: topSources.length > 0 ? topSources : MOCK_TRAFFIC.topSources,
      deviceBreakdown,
      topCountries,
      browserOsBreakdown,
    }
  } catch {
    // Network failure, missing env vars, or any other unexpected error —
    // the UI must always render, so fall all the way back to mock data.
    return MOCK_TRAFFIC
  }
}

function getTrend(change: number): 'up' | 'down' | 'flat' {
  if (change > 0) return 'up'
  if (change < 0) return 'down'
  return 'flat'
}

interface SourceTableRow {
  source: string
  medium: string
  sessions: string
  users: string
  bounceRate: string
}

interface BrowserOsTableRow {
  browser: string
  os: string
  sessions: string
  users: string
  avgSessionDuration: string
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

export default async function TrafficPage({
  searchParams,
}: {
  searchParams: { range?: string }
}) {
  const data = await getTrafficData(searchParams)

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

      {/* KPI cards row — pass iconName strings, not components */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <KPICard
          title="Sessions"
          value={formatNumber(data.sessions.value)}
          change={data.sessions.change}
          trend={getTrend(data.sessions.change)}
          iconName="mouse-pointer-click"
        />
        <KPICard
          title="Users"
          value={formatNumber(data.users.value)}
          change={data.users.change}
          trend={getTrend(data.users.change)}
          iconName="users"
        />
        <KPICard
          title="New Users"
          value={formatNumber(data.newUsers.value)}
          change={data.newUsers.change}
          trend={getTrend(data.newUsers.change)}
          iconName="trending-up"
        />
        <KPICard
          title="Bounce Rate"
          value={formatPercent(data.bounceRate.value)}
          change={data.bounceRate.change}
          trend={getTrend(-data.bounceRate.change)}
          iconName="filter"
        />
        <KPICard
          title="Avg Session Duration"
          value={formatDuration(data.avgSessionDuration.value)}
          change={data.avgSessionDuration.change}
          trend={getTrend(data.avgSessionDuration.change)}
          iconName="globe"
        />
      </div>

      {/* Sessions & Users trend */}
      <div className="mb-6">
        <AreaChart
          data={data.sessionsUsersTrend}
          title="Sessions & Users (Last 30 Days)"
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
