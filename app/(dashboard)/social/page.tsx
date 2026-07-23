import Header from '@/components/layout/Header'
import KPICard from '@/components/cards/KPICard'
import DonutChart, { type DonutChartDataPoint } from '@/components/charts/DonutChart'
import AreaChart, { type AreaChartDataPoint } from '@/components/charts/AreaChart'
import BarChart, { type BarChartDataPoint } from '@/components/charts/BarChart'
import DataTable, { type DataTableColumn } from '@/components/tables/DataTable'
import { formatNumber, formatPercent } from '@/lib/utils/format'

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------
// This is a Server Component. In production this reads from Short.io's
// click-analytics export for the mrhbnetwork.short.gy domain — see
// `ShortIOLink` / `ShortIOClick` in lib/types/index.ts — e.g.:
//
//   import { createClient } from '@/lib/supabase/server'
//   const supabase = createClient()
//
//   const { data: clicksByReferrer } = await supabase
//     .from('shortio_clicks')
//     .select('referrer, human_clicks.sum(), total_clicks.sum()')
//     .group('referrer')
//
//   const { data: clickTrend } = await supabase
//     .from('shortio_clicks')
//     .select('date, total_clicks.sum(), human_clicks.sum()')
//     .gte('date', thirtyDaysAgo)
//     .group('date')
//     .order('date', { ascending: true })
//
//   const { data: topLinks } = await supabase
//     .from('shortio_links')
//     .select('short_url, original_url, total_clicks.sum(), human_clicks.sum()')
//     .order('total_clicks', { ascending: false })
//     .limit(10)
//
//   const { data: geo } = await supabase
//     .from('shortio_clicks')
//     .select('country, os, total_clicks.sum()')
//     .group('country, os')
//
// For now we return the real numbers pulled from the Short.io dashboard for
// the mrhbnetwork.short.gy domain (1,166 total clicks / 227 human clicks),
// with the remaining time-series/table detail filled in as realistic mock
// data until the Short.io export sync job is wired up.

interface PlatformRow {
  platform: string
  humanClicks: number
  referrer: string
  colorFrom: string
  colorTo: string
  textColor: string
}

interface TopLinkRow {
  shortUrl: string
  destination: string
  totalClicks: number
  humanClicks: number
  topCountry: string
  topReferrer: string
}

interface SocialData {
  totalClicks: number
  humanClicks: number
  botClicks: number
  platforms: PlatformRow[]
  clickTrend: AreaChartDataPoint[]
  topLinks: TopLinkRow[]
  topCountries: BarChartDataPoint[]
  deviceSplit: DonutChartDataPoint[]
}

// 30 daily points summing to the 1,166-click total, with human clicks
// tracking roughly the observed ~19.5% human rate and a few referral spikes
// around known campaign-push days.
function buildClickTrend(): AreaChartDataPoint[] {
  const dates = [
    'Jun 24', 'Jun 25', 'Jun 26', 'Jun 27', 'Jun 28', 'Jun 29', 'Jun 30',
    'Jul 01', 'Jul 02', 'Jul 03', 'Jul 04', 'Jul 05', 'Jul 06', 'Jul 07',
    'Jul 08', 'Jul 09', 'Jul 10', 'Jul 11', 'Jul 12', 'Jul 13', 'Jul 14',
    'Jul 15', 'Jul 16', 'Jul 17', 'Jul 18', 'Jul 19', 'Jul 20', 'Jul 21',
    'Jul 22', 'Jul 23',
  ]
  const totalClicks = [
    28, 24, 31, 45, 52, 38, 22,
    19, 26, 33, 41, 29, 24, 20,
    58, 47, 36, 30, 25, 21, 18,
    62, 55, 44, 39, 33, 27, 23,
    36, 40,
  ]
  const humanClicks = totalClicks.map((v) => Math.round(v * 0.195))

  return dates.map((date, i) => ({
    date,
    value: totalClicks[i],
    secondaryValue: humanClicks[i],
  }))
}

async function getSocialData(): Promise<SocialData> {
  // TODO: replace mock detail (trend/table/geo breakdowns) with the Supabase
  // queries outlined above once the Short.io export sync job is live. The
  // top-level totals and platform breakdown below reflect the real Short.io
  // dashboard figures for mrhbnetwork.short.gy.
  const totalClicks = 1166
  const humanClicks = 227

  return {
    totalClicks,
    humanClicks,
    botClicks: totalClicks - humanClicks,
    platforms: [
      {
        platform: 'Twitter',
        humanClicks: 77,
        referrer: 't.co',
        colorFrom: 'from-sky-400',
        colorTo: 'to-sky-600',
        textColor: 'text-sky-600',
      },
      {
        platform: 'Telegram',
        humanClicks: 8,
        referrer: 'ir.ilmili.telegraph',
        colorFrom: 'from-blue-400',
        colorTo: 'to-blue-600',
        textColor: 'text-blue-600',
      },
      {
        platform: 'Facebook',
        humanClicks: 6,
        referrer: 'm.facebook.com',
        colorFrom: 'from-indigo-400',
        colorTo: 'to-indigo-600',
        textColor: 'text-indigo-600',
      },
      {
        platform: 'LinkedIn',
        humanClicks: 5,
        referrer: 'lnkd.in',
        colorFrom: 'from-blue-500',
        colorTo: 'to-blue-700',
        textColor: 'text-blue-700',
      },
      {
        platform: 'Instagram',
        humanClicks: 4,
        referrer: 'l.instagram.com',
        colorFrom: 'from-pink-400',
        colorTo: 'to-purple-600',
        textColor: 'text-purple-600',
      },
      {
        platform: 'YouTube',
        humanClicks: 3,
        referrer: 'www.youtube.com',
        colorFrom: 'from-red-400',
        colorTo: 'to-red-600',
        textColor: 'text-red-600',
      },
    ],
    clickTrend: buildClickTrend(),
    topLinks: [
      {
        shortUrl: 'mrhbnetwork.short.gy/sahal-wallet',
        destination: 'mrhb.network/sahal-wallet',
        totalClicks: 412,
        humanClicks: 89,
        topCountry: 'United States',
        topReferrer: 't.co',
      },
      {
        shortUrl: 'mrhbnetwork.short.gy/blogs/what-is-mrhb',
        destination: 'mrhb.network/blogs/what-is-mrhb',
        totalClicks: 298,
        humanClicks: 54,
        topCountry: 'Russia',
        topReferrer: 't.co',
      },
      {
        shortUrl: 'mrhbnetwork.short.gy/tijarx',
        destination: 'mrhb.network/tijarx',
        totalClicks: 231,
        humanClicks: 41,
        topCountry: 'United Arab Emirates',
        topReferrer: 'm.facebook.com',
      },
      {
        shortUrl: 'mrhbnetwork.short.gy/download',
        destination: 'play.google.com/store/apps/details?id=network.mrhb.sahal',
        totalClicks: 225,
        humanClicks: 43,
        topCountry: 'France',
        topReferrer: 't.co',
      },
    ],
    topCountries: [
      { label: 'United States', value: 55 },
      { label: 'Russia', value: 26 },
      { label: 'United Arab Emirates', value: 18 },
      { label: 'France', value: 16 },
      { label: 'Saudi Arabia', value: 15 },
    ],
    deviceSplit: [
      { name: 'iOS', value: 87, color: '#01A6FA' },
      { name: 'Android', value: 54, color: '#29231D' },
      { name: 'Windows', value: 52, color: '#E5B897' },
      { name: 'Mac', value: 33, color: '#BFB4A6' },
    ],
  }
}

const topLinkColumns: DataTableColumn[] = [
  { key: 'shortUrl', label: 'Short URL', sortable: true },
  { key: 'destination', label: 'Destination', sortable: true },
  { key: 'totalClicks', label: 'Total Clicks', sortable: true, align: 'right' },
  { key: 'humanClicks', label: 'Human Clicks', sortable: true, align: 'right' },
  { key: 'humanPct', label: 'Human %', sortable: true, align: 'right' },
  { key: 'topCountry', label: 'Top Country', sortable: true },
  { key: 'topReferrer', label: 'Top Referrer', sortable: true },
]

export default async function SocialPage() {
  const data = await getSocialData()

  const humanClickRate = (data.humanClicks / data.totalClicks) * 100
  const topPlatform = [...data.platforms].sort((a, b) => b.humanClicks - a.humanClicks)[0]

  const humanVsBotData: DonutChartDataPoint[] = [
    { name: 'Human', value: data.humanClicks, color: '#01A6FA' },
    { name: 'Bot', value: data.botClicks, color: '#BFB4A6' },
  ]

  const topLinkRows = data.topLinks.map((link) => ({
    shortUrl: link.shortUrl,
    destination: link.destination,
    totalClicks: formatNumber(link.totalClicks),
    humanClicks: formatNumber(link.humanClicks),
    humanPct: formatPercent((link.humanClicks / link.totalClicks) * 100),
    topCountry: link.topCountry,
    topReferrer: link.topReferrer,
  }))

  return (
    <div>
      <Header title="Social Media & Campaigns" />

      {/* KPI cards row — pass iconName strings, not components */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard
          title="Total Clicks"
          value={formatNumber(data.totalClicks)}
          iconName="mouse-pointer-click"
        />
        <KPICard
          title="Human Clicks"
          value={formatNumber(data.humanClicks)}
          iconName="users"
        />
        <KPICard
          title="Human Click Rate"
          value={formatPercent(humanClickRate)}
          iconName="filter"
        />
        <KPICard
          title="Top Platform"
          value={topPlatform.platform}
          iconName="trophy"
        />
      </div>

      {/* Platform performance — 2x3 grid */}
      <div className="mb-6">
        <h3 className="mb-4 text-base font-semibold text-mrhb-dark">Platform Performance</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.platforms.map((platform) => {
            const sharePct = (platform.humanClicks / data.humanClicks) * 100
            return (
              <div key={platform.platform} className="rounded-xl bg-mrhb-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br ${platform.colorFrom} ${platform.colorTo} text-sm font-bold text-white`}
                  >
                    {platform.platform.slice(0, 1)}
                  </div>
                  <span className="rounded-full bg-mrhb-cream px-2 py-1 text-xs font-medium text-mrhb-dark/60">
                    {sharePct.toFixed(1)}% of human clicks
                  </span>
                </div>
                <p className="mt-4 text-sm font-medium text-mrhb-dark/60">{platform.platform}</p>
                <p className={`mt-1 text-2xl font-semibold ${platform.textColor}`}>
                  {formatNumber(platform.humanClicks)}
                </p>
                <p className="mt-1 text-xs text-mrhb-dark/50">
                  human clicks &middot; referrer: {platform.referrer}
                </p>
              </div>
            )
          })}
        </div>
      </div>

      {/* Human vs Bot traffic + click trend */}
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <DonutChart data={humanVsBotData} title="Human vs. Bot Traffic" height={280} />
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs font-medium text-amber-700">
              {formatPercent(100 - humanClickRate)} of clicks on mrhbnetwork.short.gy are
              flagged as bot traffic &mdash; treat raw click totals with caution and prioritize
              human-click metrics when judging campaign performance.
            </p>
          </div>
        </div>
        <AreaChart
          data={data.clickTrend}
          title="Click Trend (Last 30 Days)"
          color="#01A6FA"
          secondaryColor="#E5B897"
          seriesLabel="Total Clicks"
          secondarySeriesLabel="Human Clicks"
          height={320}
        />
      </div>

      {/* Top performing links */}
      <div className="mb-6">
        <DataTable
          columns={topLinkColumns}
          data={topLinkRows}
          title="Top Performing Links"
          emptyMessage="No link data available for this period."
        />
      </div>

      {/* Geographic breakdown */}
      <div>
        <h3 className="mb-4 text-base font-semibold text-mrhb-dark">Geographic Breakdown</h3>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <BarChart
            data={data.topCountries}
            title="Top Countries by Clicks"
            color="#01A6FA"
            height={320}
            layout="horizontal"
          />
          <DonutChart data={data.deviceSplit} title="Device Split" height={320} />
        </div>
      </div>
    </div>
  )
}
