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
// `ShortIOClick` in lib/types/index.ts.
//
// Rows are stored at mixed grain, distinguished by `link_id`:
//   - 'domain_daily'  — one row per day, real per-day TOTAL clicks + a
//                       proportional human-click split. Authoritative source
//                       for the headline KPIs and the click trend.
//   - 'by_referrer'   — per-referrer TOTAL clicks (bot+human) for platforms.
//   - 'by_country'    — per-country TOTAL clicks for the geographic breakdown.
//   - 'by_os'         — per-OS TOTAL clicks for the device split.
//   - 'domain_total' / 'by_social' / 'by_browser' — other aggregates.
// Each section below reads ONLY the rows at its own grain so aggregate/sentinel
// rows never leak into another section's totals.
//
// If no 'domain_daily' rows exist, the Short.io sync hasn't produced usable
// daily facts; the page then renders clearly-labelled SAMPLE data (never
// presented as live) via the `isSourced` flag.

interface PlatformRow {
  platform: string
  clicks: number
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
  isSourced: boolean
}

// 30 daily points summing to the 1,166-click total, with human clicks
// tracking roughly the observed ~19.5% human rate and a few referral spikes
// around known campaign-push days. Used only for the SAMPLE fallback.
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

// Representative Short.io figures for mrhbnetwork.short.gy, used as clearly
// labelled SAMPLE data (isSourced=false) whenever no daily click facts have
// been synced. Never presented to the user as live analytics.
const MOCK_SOCIAL_DATA: SocialData = {
  totalClicks: 1166,
  humanClicks: 227,
  botClicks: 1166 - 227,
  platforms: [
    {
      platform: 'Twitter',
      clicks: 77,
      referrer: 't.co',
      colorFrom: 'from-sky-400',
      colorTo: 'to-sky-600',
      textColor: 'text-sky-600',
    },
    {
      platform: 'Telegram',
      clicks: 8,
      referrer: 'ir.ilmili.telegraph',
      colorFrom: 'from-blue-400',
      colorTo: 'to-blue-600',
      textColor: 'text-blue-600',
    },
    {
      platform: 'Facebook',
      clicks: 6,
      referrer: 'm.facebook.com',
      colorFrom: 'from-indigo-400',
      colorTo: 'to-indigo-600',
      textColor: 'text-indigo-600',
    },
    {
      platform: 'LinkedIn',
      clicks: 5,
      referrer: 'lnkd.in',
      colorFrom: 'from-blue-500',
      colorTo: 'to-blue-700',
      textColor: 'text-blue-700',
    },
    {
      platform: 'Instagram',
      clicks: 4,
      referrer: 'l.instagram.com',
      colorFrom: 'from-pink-400',
      colorTo: 'to-purple-600',
      textColor: 'text-purple-600',
    },
    {
      platform: 'YouTube',
      clicks: 3,
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
  isSourced: false,
}

// Social platform -> display label + card styling. UI-only metadata keyed by
// the social-network name Short.io reports in its "social referrers" breakdown
// (stats.social[].social), written into `shortio_clicks.referrer` on by_social
// rows. Keyed lower-case so Short.io's casing (e.g. "Youtube") still matches.
// This is the same categorization Short.io shows as "Top social referrers"
// (which aggregates all of a platform's referrer hosts), so the dashboard's
// platform cards reconcile with Short.io — unlike the raw referrer-host list,
// where a single host such as t.co under-counts a platform's real total.
const PLATFORM_STYLE_BY_SOCIAL: Record<
  string,
  { platform: string; colorFrom: string; colorTo: string; textColor: string }
> = {
  twitter: { platform: 'Twitter', colorFrom: 'from-sky-400', colorTo: 'to-sky-600', textColor: 'text-sky-600' },
  telegram: { platform: 'Telegram', colorFrom: 'from-blue-400', colorTo: 'to-blue-600', textColor: 'text-blue-600' },
  facebook: { platform: 'Facebook', colorFrom: 'from-indigo-400', colorTo: 'to-indigo-600', textColor: 'text-indigo-600' },
  linkedin: { platform: 'LinkedIn', colorFrom: 'from-blue-500', colorTo: 'to-blue-700', textColor: 'text-blue-700' },
  instagram: { platform: 'Instagram', colorFrom: 'from-pink-400', colorTo: 'to-purple-600', textColor: 'text-purple-600' },
  youtube: { platform: 'YouTube', colorFrom: 'from-red-400', colorTo: 'to-red-600', textColor: 'text-red-600' },
}

function formatTrendDate(dateStr: string): string {
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' })
}

async function getSocialData(searchParams?: { range?: string }): Promise<SocialData> {
  const supabase = createServiceClient()
  const rangeKey = searchParams?.range ?? '30d'
  const { startDate: since, endDate: until } = getDateWindow(searchParams)

  // Two independent reads, run in parallel:
  //   1. domain_daily rows BOUNDED to [since, until] — the real per-day series
  //      that draws the trend. Bounding on BOTH ends makes the trend match the
  //      selected range (a gte-only filter leaked later days into "yesterday").
  //      NOTE: Short.io decimates older granular data, so these per-day values
  //      are the honest daily pattern but do NOT necessarily sum to the period
  //      total for long windows — hence the authoritative headline below.
  //   2. The latest sync snapshot — carries the AUTHORITATIVE per-range period
  //      total (range_<key>, the figure shown in Short.io's own dashboard, used
  //      for the KPI cards) plus the dimensional breakdowns (by_social /
  //      by_country / by_os) shown as a fixed "last 30 days" reference. These
  //      snapshot rows are written together each sync (dated the run day); read
  //      only the most recent and never sum them across dates.
  const snapshotCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)

  const [dailyRes, snapshotRes] = await Promise.all([
    supabase
      .from('shortio_clicks')
      .select('date, total_clicks, human_clicks')
      .eq('link_id', 'domain_daily')
      .gte('date', since)
      .lte('date', until),
    supabase
      .from('shortio_clicks')
      .select('date, link_id, total_clicks, human_clicks, country, os, referrer')
      .in('link_id', [`range_${rangeKey}`, 'by_social', 'by_country', 'by_os'])
      .gte('date', snapshotCutoff),
  ])

  const dailyClicks = dailyRes.data ?? []
  const snapshotAll = snapshotRes.data ?? []

  // Keep only the most recent sync snapshot.
  const latestSnapshot = snapshotAll.reduce((max, c) => (c.date > max ? c.date : max), '')
  const latestRows = snapshotAll.filter((c) => c.date === latestSnapshot)
  const rangeRow = latestRows.find((c) => c.link_id === `range_${rangeKey}`)

  // "Sourced" means Short.io has synced at all. When true but the selected
  // range simply has no clicks, we show real zeros (with a friendly note) —
  // never the mock sample data.
  const isSourced =
    !snapshotRes.error && (rangeRow !== undefined || dailyClicks.length > 0 || latestRows.length > 0)
  if (!isSourced) {
    return { ...MOCK_SOCIAL_DATA, isSourced: false }
  }

  // Headline totals = the authoritative per-range period total (matches
  // Short.io's dashboard). Falls back to summing per-day rows only if the
  // range row is somehow absent.
  const totalClicks =
    rangeRow?.total_clicks ?? dailyClicks.reduce((sum, c) => sum + (c.total_clicks ?? 0), 0)
  const humanClicks =
    rangeRow?.human_clicks ?? dailyClicks.reduce((sum, c) => sum + (c.human_clicks ?? 0), 0)
  const botClicks = Math.max(0, totalClicks - humanClicks)

  // Click trend: one point per day, from the range-bounded domain_daily rows.
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

  // Platform performance: sourced from the by_social breakdown rows, which
  // mirror Short.io's "Top social referrers" (platform-level totals that
  // aggregate every referrer host for a platform). These are TOTAL clicks
  // (bot+human) — Short.io provides no per-platform human split. Rendered
  // dynamically from whatever platforms Short.io reports, styled via lookup.
  const socialRows = latestRows.filter((c) => c.link_id === 'by_social')
  const clicksBySocial = socialRows.reduce<Record<string, number>>((acc, c) => {
    if (!c.referrer) return acc
    acc[c.referrer] = (acc[c.referrer] ?? 0) + (c.total_clicks ?? 0)
    return acc
  }, {})
  const platforms: PlatformRow[] = Object.entries(clicksBySocial)
    .map(([name, clicks]) => {
      const style = PLATFORM_STYLE_BY_SOCIAL[name.toLowerCase()] ?? {
        platform: name,
        colorFrom: 'from-slate-400',
        colorTo: 'to-slate-600',
        textColor: 'text-slate-600',
      }
      return {
        platform: style.platform,
        clicks,
        referrer: name,
        colorFrom: style.colorFrom,
        colorTo: style.colorTo,
        textColor: style.textColor,
      }
    })
    .sort((a, b) => b.clicks - a.clicks)

  // Geographic breakdown: per-country TOTAL clicks from the by_country rows.
  const countryRows = latestRows.filter((c) => c.link_id === 'by_country')
  const clicksByCountry = countryRows.reduce<Record<string, number>>((acc, c) => {
    if (!c.country || c.country === 'ALL') return acc
    acc[c.country] = (acc[c.country] ?? 0) + (c.total_clicks ?? 0)
    return acc
  }, {})
  const topCountries: BarChartDataPoint[] = Object.entries(clicksByCountry)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([label, value]) => ({ label, value }))

  // Device split: per-OS TOTAL clicks from the by_os rows.
  const osRows = latestRows.filter((c) => c.link_id === 'by_os')
  const clicksByOs = osRows.reduce<Record<string, number>>((acc, c) => {
    if (!c.os || c.os === 'ALL') return acc
    acc[c.os] = (acc[c.os] ?? 0) + (c.total_clicks ?? 0)
    return acc
  }, {})
  const deviceColors = ['#01A6FA', '#29231D', '#E5B897', '#BFB4A6', '#D0EFFF']
  const deviceSplit: DonutChartDataPoint[] = Object.entries(clicksByOs)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value], index) => ({ name, value, color: deviceColors[index % deviceColors.length] }))

  // Top links: the domain-statistics endpoint does not expose per-link click
  // stats, so there is no sourced per-link breakdown at this grain. Present an
  // explicit empty state rather than aggregate pseudo-rows or mock links.
  const topLinks: TopLinkRow[] = []

  return {
    totalClicks,
    humanClicks,
    botClicks,
    platforms,
    // Real range-bounded trend — no mock fallback when a range has no clicks.
    clickTrend,
    topLinks,
    topCountries,
    deviceSplit,
    isSourced: true,
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

  const RANGE_LABELS: Record<string, string> = {
    today: 'Today',
    yesterday: 'Yesterday',
    '7d': 'Last 7 Days',
    '30d': 'Last 30 Days',
    '90d': 'Last 90 Days',
  }
  const rangeLabel = RANGE_LABELS[searchParams?.range ?? '30d'] ?? 'Last 30 Days'

  const humanClickRate = data.totalClicks > 0 ? (data.humanClicks / data.totalClicks) * 100 : 0
  const totalPlatformClicks = data.platforms.reduce((sum, p) => sum + p.clicks, 0) || 1
  const topPlatform =
    [...data.platforms].sort((a, b) => b.clicks - a.clicks)[0] ??
    { platform: '—', clicks: 0, referrer: '', colorFrom: '', colorTo: '', textColor: '' }

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

      {/* Sourced-vs-sample data state — mock is never presented as live */}
      {!data.isSourced && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-800">Showing sample data</p>
          <p className="mt-1 text-xs text-amber-700">
            Live Short.io metrics are unavailable for this period &mdash; no daily click facts
            have synced yet. The figures below are representative sample values, not sourced
            analytics. Run a Short.io sync to populate live data.
          </p>
        </div>
      )}

      {/* Sourced but no clicks in the selected window (e.g. earlier today) */}
      {data.isSourced && data.totalClicks === 0 && (
        <div className="mb-6 rounded-lg border border-mrhb-blue-light bg-mrhb-blue-light/30 p-4">
          <p className="text-sm font-medium text-mrhb-dark">
            No clicks recorded in this period yet.
          </p>
          <p className="mt-1 text-xs text-mrhb-dark/60">
            The click totals and trend below are for the selected date range. The platform,
            country, and device breakdowns reflect the last 30 days.
          </p>
        </div>
      )}

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
        <h3 className="mb-4 text-base font-semibold text-mrhb-dark">
          Platform Performance{' '}
          <span className="text-xs font-normal text-mrhb-dark/40">&middot; last 30 days</span>
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.platforms.map((platform) => {
            const sharePct = (platform.clicks / totalPlatformClicks) * 100
            return (
              <div key={platform.platform} className="rounded-xl bg-mrhb-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br ${platform.colorFrom} ${platform.colorTo} text-sm font-bold text-white`}
                  >
                    {platform.platform.slice(0, 1)}
                  </div>
                  <span className="rounded-full bg-mrhb-cream px-2 py-1 text-xs font-medium text-mrhb-dark/60">
                    {sharePct.toFixed(1)}% of platform clicks
                  </span>
                </div>
                <p className="mt-4 text-sm font-medium text-mrhb-dark/60">{platform.platform}</p>
                <p className={`mt-1 text-2xl font-semibold ${platform.textColor}`}>
                  {formatNumber(platform.clicks)}
                </p>
                <p className="mt-1 text-xs text-mrhb-dark/50">
                  clicks &middot; social referrer
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
          {data.totalClicks > 0 && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs font-medium text-amber-700">
                {formatPercent(100 - humanClickRate)} of clicks on mrhbnetwork.short.gy are
                flagged as bot traffic &mdash; treat raw click totals with caution and prioritize
                human-click metrics when judging campaign performance.
              </p>
            </div>
          )}
        </div>
        <div>
          <AreaChart
            data={data.clickTrend}
            title={`Click Trend (${rangeLabel})`}
            color="#01A6FA"
            secondaryColor="#E5B897"
            seriesLabel="Total Clicks"
            secondarySeriesLabel="Human Clicks"
            height={320}
          />
          <p className="mt-2 text-xs text-mrhb-dark/40">
            Daily clicks as recorded by Short.io. Short.io reports the headline total on a
            different basis, so the daily points may not sum to the total above.
          </p>
        </div>
      </div>

      {/* Top performing links */}
      <div className="mb-6">
        <DataTable
          columns={topLinkColumns}
          data={topLinkRows}
          title="Top Performing Links"
          emptyMessage="Per-link click breakdown isn't available from Short.io domain statistics."
        />
      </div>

      {/* Geographic breakdown */}
      <div>
        <h3 className="mb-4 text-base font-semibold text-mrhb-dark">
          Geographic Breakdown{' '}
          <span className="text-xs font-normal text-mrhb-dark/40">&middot; last 30 days</span>
        </h3>
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
