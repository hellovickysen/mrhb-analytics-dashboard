import Header from '@/components/layout/Header'
import KPICard from '@/components/cards/KPICard'
import LineChart, { type LineChartDataPoint } from '@/components/charts/LineChart'
import { formatNumber, formatPercent } from '@/lib/utils/format'

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------
// This is a Server Component. In production this would call Supabase (via
// lib/supabase/server.ts) to pull aggregated KPI rows, e.g.:
//
//   import { createClient } from '@/lib/supabase/server'
//   const supabase = createClient()
//   const { data } = await supabase
//     .from('daily_kpis')
//     .select('*')
//     .order('date', { ascending: true })
//     .limit(30)
//
// For now we return mock data so the UI structure can be reviewed before the
// Supabase schema/tables are finalized.

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

async function getOverviewData(): Promise<OverviewKPIs> {
  // TODO: replace with real Supabase query once `daily_kpis` / `sessions`
  // tables are live. Returning mock data in the same shape for now.
  return {
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
}

function getTrend(change: number): 'up' | 'down' | 'flat' {
  if (change > 0) return 'up'
  if (change < 0) return 'down'
  return 'flat'
}

export default async function OverviewPage() {
  const data = await getOverviewData()

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
        />
        <KPICard
          title="App Installs"
          value={formatNumber(data.appInstalls.value)}
          change={data.appInstalls.change}
          trend={getTrend(data.appInstalls.change)}
          iconName="smartphone"
        />
        <KPICard
          title="Organic Clicks"
          value={formatNumber(data.organicClicks.value)}
          change={data.organicClicks.change}
          trend={getTrend(data.organicClicks.change)}
          iconName="mouse-pointer-click"
        />
        <KPICard
          title="Social Clicks (Human)"
          value={formatNumber(data.socialClicksHuman.value)}
          change={data.socialClicksHuman.change}
          trend={getTrend(data.socialClicksHuman.change)}
          iconName="share2"
        />
        <KPICard
          title="Avg Scroll Depth"
          value={formatPercent(data.avgScrollDepth.value)}
          change={data.avgScrollDepth.change}
          trend={getTrend(data.avgScrollDepth.change)}
          iconName="scroll-text"
        />
        <KPICard
          title="Revenue"
          value={`$${formatNumber(data.revenue.value)}`}
          change={data.revenue.change}
          trend={getTrend(data.revenue.change)}
          iconName="dollar-sign"
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
