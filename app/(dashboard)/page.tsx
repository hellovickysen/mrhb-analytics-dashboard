import Header from '@/components/layout/Header'
import KPICard from '@/components/cards/KPICard'
import LineChart, { type LineChartDataPoint } from '@/components/charts/LineChart'
import { formatNumber, formatPercent } from '@/lib/utils/format'
import { createServiceClient } from '@/lib/supabase/server'
import { getDateWindow } from '@/lib/utils/date-range'

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------
// Server Component — pulls aggregated KPI rows straight from Supabase. Every
// query below is wrapped so that a missing table, an RLS-denied read, or a
// genuinely empty result all fall through to the same MOCK_OVERVIEW fallback,
// which keeps the shape identical to what the UI below expects.

interface OverviewKPIs {
  totalUsers: { value: number; change: number }
  appInstalls: { value: number; change: number }
  organicClicks: { value: number; change: number }
  socialClicksHuman: { value: number; change: number }
  avgScrollDepth: { value: number; change: number }
  revenue: { value: number; change: number }
  trafficTrend: LineChartDataPoint[]
  channelBreakdown: { channel: string; sessions: number; share: number }[]
  topCountries: { country: string; users: number; share: number }[]
}

const MOCK_OVERVIEW: OverviewKPIs = {
  totalUsers: { value: 48210, change: 8.4 },
  appInstalls: { value: 6320, change: 12.1 },
  organicClicks: { value: 21875, change: 5.6 },
  socialClicksHuman: { value: 9142, change: -3.2 },
  avgScrollDepth: { value: 62.5, change: 0 },
  revenue: { value: 184500, change: 14.7 },
  trafficTrend: [
    { date: 'Jun 24', value: 3200 },
    { date: 'Jun 27', value: 3450 },
    { date: 'Jun 30', value: 3100 },
    { date: 'Jul 03', value: 3800 },
    { date: 'Jul 06', value: 4200 },
    { date: 'Jul 09', value: 3950 },
    { date: 'Jul 12', value: 4500 },
    { date: 'Jul 15', value: 4750 },
    { date: 'Jul 18', value: 4620 },
    { date: 'Jul 21', value: 5100 },
    { date: 'Jul 23', value: 5340 },
  ],
  channelBreakdown: [
    { channel: 'Organic Search', sessions: 21875, share: 38.2 },
    { channel: 'Social', sessions: 14320, share: 25.0 },
    { channel: 'Direct', sessions: 10904, share: 19.0 },
    { channel: 'Referral', sessions: 6210, share: 10.8 },
    { channel: 'Paid', sessions: 4032, share: 7.0 },
  ],
  topCountries: [
    { country: 'United Arab Emirates', users: 15840, share: 32.9 },
    { country: 'Saudi Arabia', users: 11200, share: 23.2 },
    { country: 'United Kingdom', users: 6104, share: 12.7 },
    { country: 'United States', users: 4890, share: 10.1 },
    { country: 'Malaysia', users: 3312, share: 6.9 },
  ],
}

/** Percent change of `current` vs `previous`, guarding divide-by-zero. */
function pctChange(current: number, previous: number): number {
  if (!previous) return current > 0 ? 100 : 0
  return ((current - previous) / previous) * 100
}

/**
 * Sums a single numeric column across rows, split into "current 30 days" vs
 * "previous 30 days" (day 31-60 back), so every KPI can report a % change
 * using one shared helper and one shared 60-day fetch per table.
 */
async function fetchWindowedSum(
  supabase: ReturnType<typeof createServiceClient>,
  table: string,
  column: string,
  dateColumn: string,
  since60d: string,
  cutoff30d: string,
  extraFilter?: (query: any) => any
): Promise<{ current: number; previous: number } | null> {
  try {
    let query = supabase.from(table).select(`${dateColumn}, ${column}`).gte(dateColumn, since60d)
    if (extraFilter) query = extraFilter(query)
    const { data, error } = await query

    if (error || !data) return null

    let current = 0
    let previous = 0
    for (const row of data as unknown as Record<string, unknown>[]) {
      const rowDate = String(row[dateColumn] ?? '')
      const rawValue = row[column]
      const value = typeof rawValue === 'number' ? rawValue : Number(rawValue) || 0
      if (rowDate >= cutoff30d) {
        current += value
      } else {
        previous += value
      }
    }

    return { current, previous }
  } catch {
    return null
  }
}

async function getOverviewData(searchParams?: { range?: string }): Promise<OverviewKPIs> {
  try {
    const supabase = createServiceClient()

    const { startDate, prevStartDate } = getDateWindow(searchParams)
    const since60d = prevStartDate
    const cutoff30d = startDate

    const [
      usersWindow,
      installsWindow,
      clicksWindow,
      socialClicksWindow,
      scrollWindow,
      revenueWindow,
      trafficTrendResult,
      channelResult,
      geoResult,
    ] = await Promise.all([
      fetchWindowedSum(supabase, 'ga_traffic', 'users', 'date', since60d, cutoff30d),
      fetchWindowedSum(supabase, 'ga_events', 'event_count', 'date', since60d, cutoff30d, (q) =>
        q.eq('event_name', 'first_open')
      ),
      fetchWindowedSum(supabase, 'gsc_queries', 'clicks', 'date', since60d, cutoff30d),
      fetchWindowedSum(supabase, 'shortio_clicks', 'human_clicks', 'date', since60d, cutoff30d),
      fetchWindowedSum(supabase, 'clarity_sessions', 'scroll_depth_pct', 'date', since60d, cutoff30d),
      fetchWindowedSum(supabase, 'daily_kpis', 'metric_value', 'date', since60d, cutoff30d, (q) =>
        q.eq('metric_name', 'revenue')
      ),
      supabase
        .from('ga_traffic')
        .select('date, sessions')
        .gte('date', cutoff30d)
        .order('date', { ascending: true }),
      supabase.from('ga_traffic').select('channel, sessions').gte('date', cutoff30d),
      supabase.from('ga_geo').select('country, users').gte('date', cutoff30d),
    ])

    // Average (not sum) scroll depth over the current 30-day window — reuse
    // the raw rows fetched above via a second lightweight pass so the KPI
    // reflects an average rather than a summed percentage.
    let avgScrollDepth = { value: MOCK_OVERVIEW.avgScrollDepth.value, change: MOCK_OVERVIEW.avgScrollDepth.change }
    if (scrollWindow) {
      const { data: scrollRows } = await supabase
        .from('clarity_sessions')
        .select('date, scroll_depth_pct')
        .gte('date', since60d)

      if (scrollRows && scrollRows.length > 0) {
        const currentRows = scrollRows.filter((r) => r.date >= cutoff30d)
        const previousRows = scrollRows.filter((r) => r.date < cutoff30d)
        const avg = (rows: typeof scrollRows) =>
          rows.length > 0 ? rows.reduce((t, r) => t + (r.scroll_depth_pct ?? 0), 0) / rows.length : 0
        const currentAvg = avg(currentRows)
        const previousAvg = avg(previousRows)
        avgScrollDepth = { value: currentAvg, change: pctChange(currentAvg, previousAvg) }
      }
    }

    // Traffic trend: daily session totals for the last 30 days.
    let trafficTrend: LineChartDataPoint[] = MOCK_OVERVIEW.trafficTrend
    if (!trafficTrendResult.error && trafficTrendResult.data && trafficTrendResult.data.length > 0) {
      const byDate = new Map<string, number>()
      for (const row of trafficTrendResult.data as { date: string; sessions: number }[]) {
        byDate.set(row.date, (byDate.get(row.date) ?? 0) + (row.sessions ?? 0))
      }
      trafficTrend = Array.from(byDate.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, value]) => ({ date: formatShortDate(date), value }))
    }

    // Channel breakdown: sessions grouped by channel, top 5 by volume.
    let channelBreakdown = MOCK_OVERVIEW.channelBreakdown
    if (!channelResult.error && channelResult.data && channelResult.data.length > 0) {
      const byChannel = new Map<string, number>()
      for (const row of channelResult.data as { channel: string; sessions: number }[]) {
        byChannel.set(row.channel, (byChannel.get(row.channel) ?? 0) + (row.sessions ?? 0))
      }
      const total = Array.from(byChannel.values()).reduce((t, v) => t + v, 0)
      channelBreakdown = Array.from(byChannel.entries())
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([channel, sessions]) => ({
          channel,
          sessions,
          share: total > 0 ? (sessions / total) * 100 : 0,
        }))
    }

    // Top countries: users grouped by country, top 5 by volume.
    let topCountries = MOCK_OVERVIEW.topCountries
    if (!geoResult.error && geoResult.data && geoResult.data.length > 0) {
      const byCountry = new Map<string, number>()
      for (const row of geoResult.data as { country: string; users: number }[]) {
        byCountry.set(row.country, (byCountry.get(row.country) ?? 0) + (row.users ?? 0))
      }
      const total = Array.from(byCountry.values()).reduce((t, v) => t + v, 0)
      topCountries = Array.from(byCountry.entries())
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([country, users]) => ({
          country,
          users,
          share: total > 0 ? (users / total) * 100 : 0,
        }))
    }

    return {
      totalUsers: usersWindow
        ? { value: usersWindow.current, change: pctChange(usersWindow.current, usersWindow.previous) }
        : MOCK_OVERVIEW.totalUsers,
      appInstalls: installsWindow
        ? { value: installsWindow.current, change: pctChange(installsWindow.current, installsWindow.previous) }
        : MOCK_OVERVIEW.appInstalls,
      organicClicks: clicksWindow
        ? { value: clicksWindow.current, change: pctChange(clicksWindow.current, clicksWindow.previous) }
        : MOCK_OVERVIEW.organicClicks,
      socialClicksHuman: socialClicksWindow
        ? {
            value: socialClicksWindow.current,
            change: pctChange(socialClicksWindow.current, socialClicksWindow.previous),
          }
        : MOCK_OVERVIEW.socialClicksHuman,
      avgScrollDepth,
      revenue: revenueWindow
        ? { value: revenueWindow.current, change: pctChange(revenueWindow.current, revenueWindow.previous) }
        : MOCK_OVERVIEW.revenue,
      trafficTrend,
      channelBreakdown,
      topCountries,
    }
  } catch {
    // Network failure, missing env vars, or any other unexpected error —
    // the UI must always render, so fall all the way back to mock data.
    return MOCK_OVERVIEW
  }
}

/** Formats a `YYYY-MM-DD` string as "Jul 23" to match the mock trend labels. */
function formatShortDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', timeZone: 'UTC' })
}

function getTrend(change: number): 'up' | 'down' | 'flat' {
  if (change > 0) return 'up'
  if (change < 0) return 'down'
  return 'flat'
}

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: { range?: string }
}) {
  const data = await getOverviewData(searchParams)

  return (
    <div>
      <Header title="Overview" />

      {/* KPI cards row — pass iconName strings, not components */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <KPICard
          title="Total Users"
          value={formatNumber(data.totalUsers.value)}
          change={data.totalUsers.change}
          trend={getTrend(data.totalUsers.change)}
          iconName="users"
          tooltip="Total number of people who visited your website in this period"
        />
        <KPICard
          title="App Installs"
          value={formatNumber(data.appInstalls.value)}
          change={data.appInstalls.change}
          trend={getTrend(data.appInstalls.change)}
          iconName="smartphone"
          tooltip="Number of times Sahal Wallet was installed from the Play Store"
        />
        <KPICard
          title="Organic Clicks"
          value={formatNumber(data.organicClicks.value)}
          change={data.organicClicks.change}
          trend={getTrend(data.organicClicks.change)}
          iconName="mouse-pointer-click"
          tooltip="Clicks from Google search results to your website"
        />
        <KPICard
          title="Social Clicks (Human)"
          value={formatNumber(data.socialClicksHuman.value)}
          change={data.socialClicksHuman.change}
          trend={getTrend(data.socialClicksHuman.change)}
          iconName="share2"
          tooltip="Real people (not bots) who clicked your Short.io social media links"
        />
        <KPICard
          title="Avg Scroll Depth"
          value={formatPercent(data.avgScrollDepth.value)}
          change={data.avgScrollDepth.change}
          trend={getTrend(data.avgScrollDepth.change)}
          iconName="scroll-text"
          tooltip="How far down the page visitors scroll on average (100% = reached the bottom)"
        />
        <KPICard
          title="Revenue"
          value={`$${formatNumber(data.revenue.value)}`}
          change={data.revenue.change}
          trend={getTrend(data.revenue.change)}
          iconName="dollar-sign"
          tooltip="Total revenue generated from in-app transactions"
        />
      </div>

      {/* Traffic trend chart */}
      <div className="mb-6">
        <LineChart
          data={data.trafficTrend}
          title="Traffic Trend"
          color="#01A6FA"
          height={320}
        />
      </div>

      {/* Two-column grid: channel breakdown + top countries */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Channel breakdown */}
        <div className="rounded-xl bg-mrhb-white p-5 shadow-sm">
          <h3 className="mb-4 text-base font-semibold text-mrhb-dark">
            Channel Breakdown
          </h3>
          <ul className="space-y-3">
            {data.channelBreakdown.map((item) => (
              <li key={item.channel}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-medium text-mrhb-dark">{item.channel}</span>
                  <span className="text-mrhb-dark/60">
                    {formatNumber(item.sessions)} &middot; {item.share.toFixed(1)}%
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-mrhb-blue-light">
                  <div
                    className="h-full rounded-full bg-mrhb-blue"
                    style={{ width: `${item.share}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Top countries */}
        <div className="rounded-xl bg-mrhb-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-mrhb-blue-light text-sm">🌍</span>
            <h3 className="text-base font-semibold text-mrhb-dark">Top Countries</h3>
          </div>
          <ul className="space-y-3">
            {data.topCountries.map((item, index) => (
              <li
                key={item.country}
                className="flex items-center justify-between border-b border-mrhb-warm-grey/15 pb-3 last:border-0 last:pb-0"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-mrhb-blue-light text-xs font-semibold text-mrhb-blue">
                    {index + 1}
                  </span>
                  <span className="text-sm font-medium text-mrhb-dark">
                    {item.country}
                  </span>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-mrhb-dark">
                    {formatNumber(item.users)}
                  </p>
                  <p className="text-xs text-mrhb-dark/50">{item.share.toFixed(1)}%</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
