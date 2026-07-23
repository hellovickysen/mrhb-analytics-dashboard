import Header from '@/components/layout/Header'
import KPICard from '@/components/cards/KPICard'
import AreaChart, { type AreaChartDataPoint } from '@/components/charts/AreaChart'
import DonutChart, { type DonutChartDataPoint } from '@/components/charts/DonutChart'
import BarChart, { type BarChartDataPoint } from '@/components/charts/BarChart'
import DataTable, { type DataTableColumn } from '@/components/tables/DataTable'
import { formatNumber, formatPercent, formatDuration } from '@/lib/utils/format'

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------
// This is a Server Component. In production this reads from the `ga_traffic`
// table (synced nightly from the GA4 Data API — see lib/types/index.ts
// `GATraffic`), e.g.:
//
//   import { createClient } from '@/lib/supabase/server'
//   const supabase = createClient()
//
//   // KPI totals + 30-day trend
//   const { data: trend } = await supabase
//     .from('ga_traffic')
//     .select('date, sessions, users, new_users, bounce_rate, avg_session_duration')
//     .gte('date', thirtyDaysAgo)
//     .order('date', { ascending: true })
//
//   // Channel breakdown
//   const { data: channels } = await supabase
//     .from('ga_traffic')
//     .select('channel, sessions.sum(), users.sum()')
//     .gte('date', thirtyDaysAgo)
//     .group('channel')
//
//   // Source/medium table
//   const { data: sources } = await supabase
//     .from('ga_traffic')
//     .select('source, medium, sessions.sum(), users.sum(), bounce_rate.avg()')
//     .gte('date', thirtyDaysAgo)
//     .group('source, medium')
//     .order('sessions', { ascending: false })
//     .limit(10)
//
//   // Device / geo breakdown comes from `ga_geo` (see `GAGeo` type)
//   const { data: geo } = await supabase
//     .from('ga_geo')
//     .select('country, device_category, browser, os, users.sum(), sessions.sum()')
//     .gte('date', thirtyDaysAgo)
//
// For now we return mock data in the same shape so the UI can be reviewed
// before the GA4 sync job is wired up.

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

async function getTrafficData(): Promise<TrafficData> {
  // TODO: replace mock data with the Supabase queries outlined above once
  // `ga_traffic` / `ga_geo` are populated by the GA4 sync job.
  return {
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

export default async function TrafficPage() {
  const data = await getTrafficData()

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
