import Header from '@/components/layout/Header'
import KPICard from '@/components/cards/KPICard'
import AreaChart, { type AreaChartDataPoint } from '@/components/charts/AreaChart'
import BarChart, { type BarChartDataPoint } from '@/components/charts/BarChart'
import DataTable, { type DataTableColumn } from '@/components/tables/DataTable'
import { formatNumber, formatPercent, formatDate } from '@/lib/utils/format'
import { createServiceClient } from '@/lib/supabase/server'
import { getDateWindow } from '@/lib/utils/date-range'

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------
// This is a Server Component. Reads the Google Play Console export synced
// into Supabase: `play_installs` (daily install/uninstall/active-device
// counts, worldwide row has country='ALL'), `play_ratings` (daily avg rating
// + 1-5 star distribution), and `play_store_listing` (daily
// impressions -> visits -> installs funnel). supabase-js doesn't support
// server-side GROUP BY, so per-country aggregation happens client-side in JS.
//
// NOTE: `play_ratings` has no crash_rate column and there's no other Play
// Console table that tracks crashes, so crashRate stays mock-only — it's
// carried through unchanged from MOCK_APP_PERFORMANCE_DATA regardless of
// whether the rest of the page has real data.
//
// Play Console data likely isn't synced yet, so the mock fallback here is
// essential, not just defensive: if `play_installs` is empty, this function
// returns MOCK_APP_PERFORMANCE_DATA in full.

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

interface CountryInstallRow {
  country: string
  installs: number
  uninstalls: number
  netGrowth: number
  activeDevices: number
}

interface Review {
  rating: number
  text: string
  date: string
  country: string
  reviewer: string
}

interface AppPerformanceData {
  totalInstalls: KPIMetric
  activeDevices: KPIMetric
  avgRating: KPIMetric
  uninstallRate: KPIMetric
  crashRate: KPIMetric
  installTrend: AreaChartDataPoint[]
  storeFunnel: FunnelStep[]
  ratingDistribution: RatingBucket[]
  topCountries: CountryInstallRow[]
  recentReviews: Review[]
}

const MOCK_APP_PERFORMANCE_DATA: AppPerformanceData = {
  totalInstalls: { value: 6320, change: 12.1 },
  activeDevices: { value: 4180, change: 6.8 },
  avgRating: { value: 4.2, change: 2.4 },
  uninstallRate: { value: 18, change: -1.6 },
  crashRate: { value: 1.2, change: -0.4 },

  // 30-day daily installs vs. uninstalls
  installTrend: [
      { date: 'Jun 24', value: 168, secondaryValue: 42 },
      { date: 'Jun 25', value: 172, secondaryValue: 38 },
      { date: 'Jun 26', value: 159, secondaryValue: 45 },
      { date: 'Jun 27', value: 181, secondaryValue: 40 },
      { date: 'Jun 28', value: 195, secondaryValue: 51 },
      { date: 'Jun 29', value: 203, secondaryValue: 47 },
      { date: 'Jun 30', value: 188, secondaryValue: 44 },
      { date: 'Jul 01', value: 176, secondaryValue: 39 },
      { date: 'Jul 02', value: 190, secondaryValue: 41 },
      { date: 'Jul 03', value: 212, secondaryValue: 49 },
      { date: 'Jul 04', value: 224, secondaryValue: 53 },
      { date: 'Jul 05', value: 208, secondaryValue: 46 },
      { date: 'Jul 06', value: 199, secondaryValue: 42 },
      { date: 'Jul 07', value: 215, secondaryValue: 48 },
      { date: 'Jul 08', value: 231, secondaryValue: 55 },
      { date: 'Jul 09', value: 219, secondaryValue: 50 },
      { date: 'Jul 10', value: 206, secondaryValue: 44 },
      { date: 'Jul 11', value: 228, secondaryValue: 52 },
      { date: 'Jul 12', value: 241, secondaryValue: 58 },
      { date: 'Jul 13', value: 235, secondaryValue: 54 },
      { date: 'Jul 14', value: 222, secondaryValue: 49 },
      { date: 'Jul 15', value: 244, secondaryValue: 56 },
      { date: 'Jul 16', value: 256, secondaryValue: 61 },
      { date: 'Jul 17', value: 248, secondaryValue: 57 },
      { date: 'Jul 18', value: 233, secondaryValue: 53 },
      { date: 'Jul 19', value: 251, secondaryValue: 59 },
      { date: 'Jul 20', value: 267, secondaryValue: 63 },
      { date: 'Jul 21', value: 259, secondaryValue: 60 },
      { date: 'Jul 22', value: 242, secondaryValue: 55 },
      { date: 'Jul 23', value: 263, secondaryValue: 58 },
    ],

    // Store listing funnel: Impressions -> Store Visits -> Installs
    storeFunnel: [
      { label: 'Impressions', value: 42000 },
      { label: 'Store Visits', value: 18500 },
      { label: 'Installs', value: 6320 },
    ],

    ratingDistribution: [
      { label: '5 star', value: 2840 },
      { label: '4 star', value: 1120 },
      { label: '3 star', value: 580 },
      { label: '2 star', value: 310 },
      { label: '1 star', value: 150 },
    ],

    topCountries: [
      { country: 'United Arab Emirates', installs: 1620, uninstalls: 218, netGrowth: 1402, activeDevices: 1180 },
      { country: 'Saudi Arabia', installs: 1340, uninstalls: 201, netGrowth: 1139, activeDevices: 942 },
      { country: 'United Kingdom', installs: 890, uninstalls: 156, netGrowth: 734, activeDevices: 588 },
      { country: 'Malaysia', installs: 610, uninstalls: 94, netGrowth: 516, activeDevices: 402 },
      { country: 'Indonesia', installs: 545, uninstalls: 112, netGrowth: 433, activeDevices: 358 },
      { country: 'Turkey', installs: 412, uninstalls: 88, netGrowth: 324, activeDevices: 266 },
      { country: 'France', installs: 298, uninstalls: 61, netGrowth: 237, activeDevices: 201 },
      { country: 'United States', installs: 265, uninstalls: 58, netGrowth: 207, activeDevices: 178 },
      { country: 'Pakistan', installs: 214, uninstalls: 49, netGrowth: 165, activeDevices: 142 },
      { country: 'Nigeria', installs: 126, uninstalls: 30, netGrowth: 96, activeDevices: 88 },
    ],

    recentReviews: [
      {
        rating: 5,
        text: "Finally a wallet that actually screens tokens for Shariah compliance before I buy. Halalytix caught a token I almost swapped into — saved me from a haram trade. Sahal Wallet is my daily driver now.",
        date: '2026-07-21',
        country: 'United Arab Emirates',
        reviewer: 'Ahmed K.',
      },
      {
        rating: 5,
        text: 'TijarX made commodity-backed investing so simple. I love that everything is asset-backed and I can see the gold reserve details right in the app. UI is clean and fast too.',
        date: '2026-07-19',
        country: 'Malaysia',
        reviewer: 'Nur A.',
      },
      {
        rating: 4,
        text: 'Sahal Give is a great touch — donating straight from my wallet balance to verified causes without leaving the app. Wish the transaction history loaded a bit faster on 3G.',
        date: '2026-07-17',
        country: 'Indonesia',
        reviewer: 'Budi S.',
      },
      {
        rating: 3,
        text: 'App is solid overall but KYC verification took almost two days for me. Once approved, staking through Sahal Earn was straightforward and the returns dashboard is nice.',
        date: '2026-07-14',
        country: 'Turkey',
        reviewer: 'Elif Y.',
      },
      {
        rating: 5,
        text: "Been using MRHB Store to buy gift cards with my crypto balance without ever touching an exchange. Halal-first design shows in every detail, from the token screener to the fee breakdown.",
        date: '2026-07-11',
        country: 'Saudi Arabia',
        reviewer: 'Faisal M.',
      },
    ],
}

function formatTrendDate(dateStr: string): string {
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' })
}

async function getAppPerformanceData(searchParams?: { range?: string }): Promise<AppPerformanceData> {
  const supabase = createServiceClient()
  const { startDate: since } = getDateWindow(searchParams)

  const [installsRes, ratingsRes, storeListingRes] = await Promise.all([
    supabase
      .from('play_installs')
      .select('date, installs, uninstalls, active_devices, update_installs, country')
      .gte('date', since),
    supabase
      .from('play_ratings')
      .select('date, avg_rating, total_ratings, star_1, star_2, star_3, star_4, star_5, reviews_count')
      .order('date', { ascending: false })
      .limit(1),
    supabase
      .from('play_store_listing')
      .select('date, impressions, visits, installs, install_conversion_rate, country')
      .gte('date', since),
  ])

  const installs = installsRes.data ?? []
  const ratings = ratingsRes.data ?? []
  const storeListing = storeListingRes.data ?? []

  const hasInstalls = !installsRes.error && installs.length > 0

  if (!hasInstalls) {
    return MOCK_APP_PERFORMANCE_DATA
  }

  const worldwide = installs.filter((r) => r.country === 'ALL')
  const perCountry = installs.filter((r) => r.country !== 'ALL')
  const rows = worldwide.length > 0 ? worldwide : installs

  const totalInstalls = rows.reduce((sum, r) => sum + (r.installs ?? 0), 0)
  const totalUninstalls = rows.reduce((sum, r) => sum + (r.uninstalls ?? 0), 0)
  const activeDevices = rows.length > 0 ? rows[rows.length - 1].active_devices ?? 0 : 0
  const uninstallRate = totalInstalls > 0 ? (totalUninstalls / totalInstalls) * 100 : 0

  // Day-over-day change: compare the most recent day to the prior day.
  const sortedRows = [...rows].sort((a, b) => (a.date < b.date ? -1 : 1))
  const latest = sortedRows[sortedRows.length - 1]
  const previous = sortedRows.length > 1 ? sortedRows[sortedRows.length - 2] : null
  const changePct = (current: number, prev: number | null | undefined): number => {
    if (!prev) return 0
    return ((current - prev) / prev) * 100
  }

  const latestRating = ratings[0]
  const avgRating = latestRating?.avg_rating ?? MOCK_APP_PERFORMANCE_DATA.avgRating.value

  const installTrend: AreaChartDataPoint[] = sortedRows.map((r) => ({
    date: formatTrendDate(r.date),
    value: r.installs ?? 0,
    secondaryValue: r.uninstalls ?? 0,
  }))

  // Store listing funnel: sum impressions/visits/installs for the ALL
  // (worldwide) rows across the window, falling back to all rows if no
  // explicit worldwide aggregate exists.
  const storeListingWorldwide = storeListing.filter((r) => r.country === 'ALL')
  const storeListingRows = storeListingWorldwide.length > 0 ? storeListingWorldwide : storeListing
  const totalImpressions = storeListingRows.reduce((sum, r) => sum + (r.impressions ?? 0), 0)
  const totalVisits = storeListingRows.reduce((sum, r) => sum + (r.visits ?? 0), 0)
  const totalStoreInstalls = storeListingRows.reduce((sum, r) => sum + (r.installs ?? 0), 0)

  const storeFunnel: FunnelStep[] =
    storeListingRows.length > 0
      ? [
          { label: 'Impressions', value: totalImpressions },
          { label: 'Store Visits', value: totalVisits },
          { label: 'Installs', value: totalStoreInstalls },
        ]
      : MOCK_APP_PERFORMANCE_DATA.storeFunnel

  const ratingDistribution: RatingBucket[] = latestRating
    ? [
        { label: '5 star', value: latestRating.star_5 ?? 0 },
        { label: '4 star', value: latestRating.star_4 ?? 0 },
        { label: '3 star', value: latestRating.star_3 ?? 0 },
        { label: '2 star', value: latestRating.star_2 ?? 0 },
        { label: '1 star', value: latestRating.star_1 ?? 0 },
      ]
    : MOCK_APP_PERFORMANCE_DATA.ratingDistribution

  // Top install countries: aggregate per-country rows across the window.
  const byCountry = new Map<string, { installs: number; uninstalls: number; activeDevices: number }>()
  for (const r of perCountry) {
    const entry = byCountry.get(r.country) ?? { installs: 0, uninstalls: 0, activeDevices: 0 }
    entry.installs += r.installs ?? 0
    entry.uninstalls += r.uninstalls ?? 0
    entry.activeDevices = Math.max(entry.activeDevices, r.active_devices ?? 0)
    byCountry.set(r.country, entry)
  }
  const topCountries: CountryInstallRow[] = Array.from(byCountry.entries())
    .map(([country, agg]) => ({
      country,
      installs: agg.installs,
      uninstalls: agg.uninstalls,
      netGrowth: agg.installs - agg.uninstalls,
      activeDevices: agg.activeDevices,
    }))
    .sort((a, b) => b.installs - a.installs)
    .slice(0, 10)

  return {
    totalInstalls: { value: totalInstalls, change: changePct(latest?.installs ?? 0, previous?.installs) },
    activeDevices: {
      value: activeDevices,
      change: changePct(latest?.active_devices ?? 0, previous?.active_devices),
    },
    avgRating: { value: avgRating, change: MOCK_APP_PERFORMANCE_DATA.avgRating.change },
    uninstallRate: { value: uninstallRate, change: MOCK_APP_PERFORMANCE_DATA.uninstallRate.change },
    // No source table tracks app crashes — always mock.
    crashRate: MOCK_APP_PERFORMANCE_DATA.crashRate,
    installTrend: installTrend.length > 0 ? installTrend : MOCK_APP_PERFORMANCE_DATA.installTrend,
    storeFunnel,
    ratingDistribution,
    topCountries: topCountries.length > 0 ? topCountries : MOCK_APP_PERFORMANCE_DATA.topCountries,
    // No Play Console review-text table exists yet — always mock.
    recentReviews: MOCK_APP_PERFORMANCE_DATA.recentReviews,
  }
}

function getTrend(change: number): 'up' | 'down' | 'flat' {
  if (change > 0) return 'up'
  if (change < 0) return 'down'
  return 'flat'
}

// Uninstall rate and crash rate are metrics where a decrease is the positive
// direction — invert the trend color/arrow relative to the raw sign of the
// period-over-period change.
function getInverseTrend(change: number): 'up' | 'down' | 'flat' {
  if (change > 0) return 'down'
  if (change < 0) return 'up'
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

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5" aria-label={`${rating} out of 5 stars`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <span
          key={i}
          className={i < rating ? 'text-mrhb-warm-tan' : 'text-mrhb-warm-grey/30'}
        >
          ★
        </span>
      ))}
    </div>
  )
}

const COUNTRY_COLUMNS: DataTableColumn[] = [
  { key: 'country', label: 'Country', align: 'left' },
  { key: 'installs', label: 'Installs', align: 'right', sortable: true },
  { key: 'uninstalls', label: 'Uninstalls', align: 'right', sortable: true },
  { key: 'netGrowth', label: 'Net Growth', align: 'right', sortable: true },
  { key: 'activeDevices', label: 'Active Devices', align: 'right', sortable: true },
]

export default async function AppPerformancePage({
  searchParams,
}: {
  searchParams: { range?: string }
}) {
  const data = await getAppPerformanceData(searchParams)
  const funnelBars = buildFunnelBars(data.storeFunnel)
  const conversionRates = funnelConversionRates(data.storeFunnel)

  const countryTableRows = data.topCountries.map((row) => ({
    country: row.country,
    installs: formatNumber(row.installs),
    uninstalls: formatNumber(row.uninstalls),
    netGrowth: `+${formatNumber(row.netGrowth)}`,
    activeDevices: formatNumber(row.activeDevices),
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
        />
        <KPICard
          title="Active Devices"
          value={formatNumber(data.activeDevices.value)}
          change={data.activeDevices.change}
          trend={getTrend(data.activeDevices.change)}
          iconName="users"
        />
        <KPICard
          title="Avg Rating"
          value={data.avgRating.value.toFixed(1)}
          change={data.avgRating.change}
          trend={getTrend(data.avgRating.change)}
          iconName="trending-up"
        />
        <KPICard
          title="Uninstall Rate"
          value={formatPercent(data.uninstallRate.value)}
          change={data.uninstallRate.change}
          trend={getInverseTrend(data.uninstallRate.change)}
          iconName="filter"
        />
        <KPICard
          title="Crash Rate"
          value={formatPercent(data.crashRate.value)}
          change={data.crashRate.change}
          trend={getInverseTrend(data.crashRate.change)}
          iconName="settings"
        />
      </div>

      {/* Install trend — 30 day installs vs uninstalls */}
      <div className="mb-6">
        <AreaChart
          data={data.installTrend}
          title="Install Trend (30 Days)"
          color="#01A6FA"
          fillColor="#D0EFFF"
          seriesLabel="Installs"
          secondarySeriesLabel="Uninstalls"
          secondaryColor="#E5B897"
          height={320}
        />
      </div>

      {/* Two-column grid: store funnel + rating distribution */}
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Store listing funnel */}
        <div>
          <BarChart
            data={funnelBars}
            title="Store Listing Funnel"
            color="#01A6FA"
            height={280}
            layout="vertical"
          />
          <div className="mt-3 grid grid-cols-2 gap-3">
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
        <BarChart
          data={data.ratingDistribution}
          title="Rating Distribution"
          color="#E5B897"
          height={340}
          layout="horizontal"
        />
      </div>

      {/* Top install countries */}
      <div className="mb-6">
        <DataTable
          columns={COUNTRY_COLUMNS}
          data={countryTableRows}
          title="Top Install Countries"
          emptyMessage="No install data available for this period."
        />
      </div>

      {/* Recent reviews */}
      <div>
        <h3 className="mb-4 text-base font-semibold text-mrhb-dark">Recent Reviews</h3>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {data.recentReviews.map((review, index) => (
            <div key={index} className="rounded-xl bg-mrhb-white p-5 shadow-sm">
              <div className="mb-2 flex items-center justify-between">
                <StarRating rating={review.rating} />
                <span className="text-xs text-mrhb-dark/50">{formatDate(review.date)}</span>
              </div>
              <p className="text-sm leading-relaxed text-mrhb-dark/80">
                &ldquo;{review.text}&rdquo;
              </p>
              <div className="mt-3 flex items-center gap-2 text-xs text-mrhb-dark/50">
                <span className="font-medium text-mrhb-dark/70">{review.reviewer}</span>
                <span>&middot;</span>
                <span>{review.country}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
