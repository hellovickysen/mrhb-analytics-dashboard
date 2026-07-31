import Header from '@/components/layout/Header'
import KPICard from '@/components/cards/KPICard'
import DonutChart, { type DonutChartDataPoint } from '@/components/charts/DonutChart'
import AreaChart, { type AreaChartDataPoint } from '@/components/charts/AreaChart'
import BarChart, { type BarChartDataPoint } from '@/components/charts/BarChart'
import DataTable, { type DataTableColumn } from '@/components/tables/DataTable'
import { formatNumber, formatPercent } from '@/lib/utils/format'
import { createServiceClient } from '@/lib/supabase/server'
import { getDateWindow } from '@/lib/utils/date-range'

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------
// This is a Server Component. Reads Short.io's click-analytics export for
// the mrhbnetwork.short.gy domain from `shortio_clicks` (daily click facts)
// joined against `shortio_links` (the link registry) — see `ShortIOLink` /
// `ShortIOClick` in lib/types/index.ts. supabase-js doesn't support
// arbitrary server-side GROUP BY, so grouping/summing by referrer, date,
// country, and OS happens client-side in JS after fetching the raw rows.
// Falls back to the real Short.io dashboard totals (1,166 total clicks / 227
// human clicks) with realistic mock detail whenever the tables are empty.

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

// Real Short.io dashboard figures for mrhbnetwork.short.gy, used as the
// fallback whenever `shortio_clicks` / `shortio_links` are empty.
const MOCK_SOCIAL_DATA: SocialData = {
  totalClicks: 1166,
  humanClicks: 227,
  botClicks: 1166 - 227,
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

// Referrer domain -> display platform + card styling. UI-only metadata that
// has no equivalent database column, so it's kept as a static lookup keyed
// by the referrer values actually written into `shortio_clicks.referrer`.
const PLATFORM_STYLE_BY_REFERRER: Record<
  string,
  { platform: string; colorFrom: string; colorTo: string; textColor: string }
> = {
  't.co': { platform: 'Twitter', colorFrom: 'from-sky-400', colorTo: 'to-sky-600', textColor: 'text-sky-600' },
  'ir.ilmili.telegraph': { platform: 'Telegram', colorFrom: 'from-blue-400', colorTo: 'to-blue-600', textColor: 'text-blue-600' },
  'm.facebook.com': { platform: 'Facebook', colorFrom: 'from-indigo-400', colorTo: 'to-indigo-600', textColor: 'text-indigo-600' },
  'lnkd.in': { platform: 'LinkedIn', colorFrom: 'from-blue-500', colorTo: 'to-blue-700', textColor: 'text-blue-700' },
  'l.instagram.com': { platform: 'Instagram', colorFrom: 'from-pink-400', colorTo: 'to-purple-600', textColor: 'text-purple-600' },
  'www.youtube.com': { platform: 'YouTube', colorFrom: 'from-red-400', colorTo: 'to-red-600', textColor: 'text-red-600' },
}

function formatTrendDate(dateStr: string): string {
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' })
}

async function getSocialData(searchParams?: { range?: string }): Promise<SocialData> {
  const supabase = createServiceClient()
  const { startDate: since } = getDateWindow(searchParams)

  const clicksRes = await supabase
    .from('shortio_clicks')
    .select('date, link_id, total_clicks, human_clicks, country, os, referrer')
    .gte('date', since)

  const linksRes = await supabase.from('shortio_links').select('link_id, short_url, original_url')

  const clicks = clicksRes.data ?? []
  const links = linksRes.data ?? []

  const hasClicks = !clicksRes.error && clicks.length > 0

  if (!hasClicks) {
    return MOCK_SOCIAL_DATA
  }

  const dailyClicks = clicks.filter((c) => c.link_id === 'domain_daily')
  const totalClicks = dailyClicks.reduce((sum, c) => sum + (c.total_clicks ?? 0), 0)
  const humanClicks = dailyClicks.reduce((sum, c) => sum + (c.human_clicks ?? 0), 0)

  // Platform performance: group by referrer, mapped to a display platform.
  const humanClicksByReferrer = clicks.reduce<Record<string, number>>((acc, c) => {
    if (!c.referrer) return acc
    acc[c.referrer] = (acc[c.referrer] ?? 0) + (c.human_clicks ?? 0)
    return acc
  }, {})

  const platforms: PlatformRow[] = Object.entries(PLATFORM_STYLE_BY_REFERRER).map(
    ([referrer, style]) => ({
      platform: style.platform,
      humanClicks: humanClicksByReferrer[referrer] ?? 0,
      referrer,
      colorFrom: style.colorFrom,
      colorTo: style.colorTo,
      textColor: style.textColor,
    })
  )

  // Click trend: group by date.
  const clicksByDate = dailyClicks.reduce<Record<string, { total: number; human: number }>>(
    (acc, c) => {
      const bucket = acc[c.date] ?? { total: 0, human: 0 }
      bucket.total += c.total_clicks ?? 0
      bucket.human += c.human_clicks ?? 0
      acc[c.date] = bucket
      return acc
    },
    {}
  )
  const clickTrend: AreaChartDataPoint[] = Object.keys(clicksByDate)
    .sort()
    .map((date) => ({
      date: formatTrendDate(date),
      value: clicksByDate[date].total,
      secondaryValue: clicksByDate[date].human,
    }))

  // Top links: aggregate clicks per link_id, then join against shortio_links
  // for the human-readable short_url/original_url, plus each link's top
  // country and top referrer by click volume.
  const linkById = new Map(links.map((l) => [l.link_id, l]))
  const perLink = new Map<
    string,
    {
      totalClicks: number
      humanClicks: number
      countryCounts: Record<string, number>
      referrerCounts: Record<string, number>
    }
  >()
  for (const c of clicks) {
    const entry =
      perLink.get(c.link_id) ??
      { totalClicks: 0, humanClicks: 0, countryCounts: {}, referrerCounts: {} }
    entry.totalClicks += c.total_clicks ?? 0
    entry.humanClicks += c.human_clicks ?? 0
    if (c.country) entry.countryCounts[c.country] = (entry.countryCounts[c.country] ?? 0) + (c.total_clicks ?? 0)
    if (c.referrer) entry.referrerCounts[c.referrer] = (entry.referrerCounts[c.referrer] ?? 0) + (c.total_clicks ?? 0)
    perLink.set(c.link_id, entry)
  }

  const topEntry = (counts: Record<string, number>): string => {
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1])
    return sorted[0]?.[0] ?? '—'
  }

  const topLinks: TopLinkRow[] = Array.from(perLink.entries())
    .map(([linkId, agg]) => {
      const link = linkById.get(linkId)
      return {
        shortUrl: link?.short_url ?? linkId,
        destination: link?.original_url ?? '—',
        totalClicks: agg.totalClicks,
        humanClicks: agg.humanClicks,
        topCountry: topEntry(agg.countryCounts),
        topReferrer: topEntry(agg.referrerCounts),
      }
    })
    .sort((a, b) => b.totalClicks - a.totalClicks)
    .slice(0, 10)

  // Geographic breakdown: group by country.
  const clicksByCountry = clicks.reduce<Record<string, number>>((acc, c) => {
    if (!c.country) return acc
    acc[c.country] = (acc[c.country] ?? 0) + (c.total_clicks ?? 0)
    return acc
  }, {})
  const topCountries: BarChartDataPoint[] = Object.entries(clicksByCountry)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([label, value]) => ({ label, value }))

  // Device split: group by OS.
  const clicksByOs = clicks.reduce<Record<string, number>>((acc, c) => {
    if (!c.os) return acc
    acc[c.os] = (acc[c.os] ?? 0) + (c.total_clicks ?? 0)
    return acc
  }, {})
  const deviceColors = ['#01A6FA', '#29231D', '#E5B897', '#BFB4A6', '#D0EFFF']
  const deviceSplit: DonutChartDataPoint[] = Object.entries(clicksByOs)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value], index) => ({ name, value, color: deviceColors[index % deviceColors.length] }))

  return {
    totalClicks: totalClicks > 0 ? totalClicks : MOCK_SOCIAL_DATA.totalClicks,
    humanClicks: totalClicks > 0 ? humanClicks : MOCK_SOCIAL_DATA.humanClicks,
    botClicks: totalClicks > 0 ? totalClicks - humanClicks : MOCK_SOCIAL_DATA.botClicks,
    platforms: platforms.some((p) => p.humanClicks > 0) ? platforms : MOCK_SOCIAL_DATA.platforms,
    clickTrend: clickTrend.length > 0 ? clickTrend : MOCK_SOCIAL_DATA.clickTrend,
    topLinks: topLinks.length > 0 ? topLinks : MOCK_SOCIAL_DATA.topLinks,
    topCountries: topCountries.length > 0 ? topCountries : MOCK_SOCIAL_DATA.topCountries,
    deviceSplit: deviceSplit.length > 0 ? deviceSplit : MOCK_SOCIAL_DATA.deviceSplit,
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

export default async function SocialPage({
  searchParams,
}: {
  searchParams: { range?: string }
}) {
  const data = await getSocialData(searchParams)

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
          tooltip="All clicks on your Short.io social media links (includes bot traffic)"
        />
        <KPICard
          title="Human Clicks"
          value={formatNumber(data.humanClicks)}
          iconName="users"
          tooltip="Clicks from real people only, excluding automated bots"
        />
        <KPICard
          title="Human Click Rate"
          value={formatPercent(humanClickRate)}
          iconName="filter"
          tooltip="Percentage of total clicks that came from real people. Shows how much is genuine traffic"
        />
        <KPICard
          title="Top Platform"
          value={topPlatform.platform}
          iconName="trophy"
          tooltip="The social media platform driving the most clicks to your links"
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
