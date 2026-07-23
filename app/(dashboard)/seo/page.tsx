import Header from '@/components/layout/Header'
import KPICard from '@/components/cards/KPICard'
import AreaChart, { type AreaChartDataPoint } from '@/components/charts/AreaChart'
import LineChart, { type LineChartDataPoint } from '@/components/charts/LineChart'
import BarChart, { type BarChartDataPoint } from '@/components/charts/BarChart'
import DataTable, { type DataTableColumn } from '@/components/tables/DataTable'
import { formatNumber, formatPercent } from '@/lib/utils/format'

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------
// This is a Server Component. In production this reads from the `gsc_query`
// / `gsc_page` tables (synced daily from the Search Console API — see
// lib/types/index.ts `GSCQuery` / `GSCPage`), e.g.:
//
//   import { createClient } from '@/lib/supabase/server'
//   const supabase = createClient()
//
//   // KPI totals + 30-day impressions/clicks trend
//   const { data: trend } = await supabase
//     .from('gsc_query')
//     .select('date, impressions.sum(), clicks.sum(), ctr.avg(), position.avg()')
//     .gte('date', thirtyDaysAgo)
//     .group('date')
//     .order('date', { ascending: true })
//
//   // Top queries
//   const { data: queries } = await supabase
//     .from('gsc_query')
//     .select('query, impressions.sum(), clicks.sum(), ctr.avg(), position.avg()')
//     .gte('date', thirtyDaysAgo)
//     .group('query')
//     .order('impressions', { ascending: false })
//     .limit(15)
//
//   // Top pages
//   const { data: pages } = await supabase
//     .from('gsc_page')
//     .select('page, impressions.sum(), clicks.sum(), ctr.avg(), position.avg()')
//     .gte('date', thirtyDaysAgo)
//     .group('page')
//     .order('impressions', { ascending: false })
//     .limit(10)
//
//   // Position distribution — bucket `position` per query row, e.g. via an
//   // RPC/materialized view since Postgres can't `CASE`-bucket inside .group()
//   const { data: positionBuckets } = await supabase.rpc('gsc_position_distribution', {
//     start_date: thirtyDaysAgo,
//   })
//
// For now we return mock data in the same shape so the UI can be reviewed
// before the Search Console sync job is wired up.

interface QueryRow {
  query: string
  impressions: number
  clicks: number
  ctr: number
  position: number
}

interface PageRow {
  page: string
  impressions: number
  clicks: number
  ctr: number
  position: number
}

interface SeoData {
  totalImpressions: { value: number; change: number }
  totalClicks: { value: number; change: number }
  avgCtr: { value: number; change: number }
  avgPosition: { value: number; change: number }
  impressionsClicksTrend: AreaChartDataPoint[]
  ctrTrend: LineChartDataPoint[]
  topQueries: QueryRow[]
  topPages: PageRow[]
  positionDistribution: BarChartDataPoint[]
}

function buildImpressionsClicksTrend(): AreaChartDataPoint[] {
  const dates = [
    'Jun 24', 'Jun 25', 'Jun 26', 'Jun 27', 'Jun 28', 'Jun 29', 'Jun 30',
    'Jul 01', 'Jul 02', 'Jul 03', 'Jul 04', 'Jul 05', 'Jul 06', 'Jul 07',
    'Jul 08', 'Jul 09', 'Jul 10', 'Jul 11', 'Jul 12', 'Jul 13', 'Jul 14',
    'Jul 15', 'Jul 16', 'Jul 17', 'Jul 18', 'Jul 19', 'Jul 20', 'Jul 21',
    'Jul 22', 'Jul 23',
  ]
  const impressions = [
    8420, 8710, 8560, 8390, 7980, 7840, 8010,
    9120, 9380, 9260, 9040, 8720, 8590, 8810,
    9860, 10120, 9940, 9680, 9310, 9150, 9420,
    10740, 11080, 10920, 10510, 9980, 9760, 10180,
    11460, 11920,
  ]
  const clicks = [
    312, 328, 319, 305, 288, 279, 291,
    342, 356, 349, 334, 315, 306, 320,
    378, 392, 384, 368, 349, 340, 356,
    418, 436, 428, 405, 380, 368, 392,
    452, 476,
  ]

  return dates.map((date, i) => ({
    date,
    value: impressions[i],
    secondaryValue: clicks[i],
  }))
}

function buildCtrTrend(): LineChartDataPoint[] {
  // Weekly CTR samples — computed as clicks/impressions, hovering in the
  // 3.4%-4.2% band typical for a mid-authority fintech content site.
  return [
    { date: 'Jun 24', value: 3.7 },
    { date: 'Jul 01', value: 3.6 },
    { date: 'Jul 08', value: 3.9 },
    { date: 'Jul 15', value: 3.9 },
    { date: 'Jul 23', value: 4.0 },
  ]
}

async function getSeoData(): Promise<SeoData> {
  // TODO: replace mock data with the Supabase queries outlined above once
  // `gsc_query` / `gsc_page` are populated by the Search Console sync job.
  return {
    totalImpressions: { value: 284650, change: 13.2 },
    totalClicks: { value: 10842, change: 9.6 },
    avgCtr: { value: 3.8, change: 0.4 },
    avgPosition: { value: 14.6, change: -1.8 },
    impressionsClicksTrend: buildImpressionsClicksTrend(),
    ctrTrend: buildCtrTrend(),
    topQueries: [
      { query: 'what is halal fintech', impressions: 18420, clicks: 1240, ctr: 6.7, position: 4.2 },
      { query: 'halal investment app', impressions: 15680, clicks: 890, ctr: 5.7, position: 6.1 },
      { query: 'is crypto halal', impressions: 22140, clicks: 780, ctr: 3.5, position: 9.8 },
      { query: 'sahal wallet', impressions: 9210, clicks: 1120, ctr: 12.2, position: 1.4 },
      { query: 'halal defi', impressions: 12480, clicks: 610, ctr: 4.9, position: 8.3 },
      { query: 'sharia compliant savings account', impressions: 8740, clicks: 470, ctr: 5.4, position: 7.6 },
      { query: 'mrhb network', impressions: 6120, clicks: 890, ctr: 14.5, position: 1.1 },
      { query: 'halal budgeting app uae', impressions: 7340, clicks: 380, ctr: 5.2, position: 6.9 },
      { query: 'islamic fintech companies', impressions: 11960, clicks: 340, ctr: 2.8, position: 12.4 },
      { query: 'zakat calculator online', impressions: 14280, clicks: 520, ctr: 3.6, position: 10.7 },
      { query: 'halal staking crypto', impressions: 9680, clicks: 290, ctr: 3.0, position: 13.2 },
      { query: 'is bitcoin haram or halal', impressions: 19340, clicks: 410, ctr: 2.1, position: 16.5 },
      { query: 'best halal savings app dubai', impressions: 5210, clicks: 310, ctr: 5.9, position: 5.8 },
      { query: 'sadaqah coin', impressions: 4890, clicks: 260, ctr: 5.3, position: 4.6 },
      { query: 'halal p2p lending', impressions: 6780, clicks: 180, ctr: 2.7, position: 15.9 },
    ],
    topPages: [
      { page: '/blogs/what-is-halal-fintech', impressions: 32140, clicks: 2180, ctr: 6.8, position: 5.1 },
      { page: '/blogs/is-crypto-halal-or-haram', impressions: 41280, clicks: 1640, ctr: 4.0, position: 9.4 },
      { page: '/', impressions: 18960, clicks: 1980, ctr: 10.4, position: 2.3 },
      { page: '/blogs/halal-defi-explained', impressions: 22740, clicks: 1120, ctr: 4.9, position: 8.7 },
      { page: '/sahal-wallet', impressions: 14680, clicks: 1780, ctr: 12.1, position: 1.6 },
      { page: '/blogs/zakat-calculator-guide', impressions: 19420, clicks: 890, ctr: 4.6, position: 10.2 },
      { page: '/blogs/sharia-compliant-savings', impressions: 12980, clicks: 740, ctr: 5.7, position: 7.3 },
      { page: '/blogs/is-bitcoin-haram', impressions: 27340, clicks: 610, ctr: 2.2, position: 15.8 },
      { page: '/about', impressions: 6840, clicks: 520, ctr: 7.6, position: 3.9 },
      { page: '/blogs/halal-p2p-lending-guide', impressions: 9120, clicks: 280, ctr: 3.1, position: 14.6 },
    ],
    positionDistribution: [
      { label: 'Position 1-3', value: 42 },
      { label: 'Position 4-10', value: 118 },
      { label: 'Position 11-20', value: 96 },
      { label: 'Position 21-50', value: 134 },
      { label: 'Position 50+', value: 87 },
    ],
  }
}

function getTrend(change: number): 'up' | 'down' | 'flat' {
  if (change > 0) return 'up'
  if (change < 0) return 'down'
  return 'flat'
}

interface QueryTableRow {
  query: string
  impressions: string
  clicks: string
  ctr: string
  position: string
}

interface PageTableRow {
  page: string
  impressions: string
  clicks: string
  ctr: string
  position: string
}

const queryColumns: DataTableColumn[] = [
  { key: 'query', label: 'Query', sortable: true },
  { key: 'impressions', label: 'Impressions', sortable: true, align: 'right' },
  { key: 'clicks', label: 'Clicks', sortable: true, align: 'right' },
  { key: 'ctr', label: 'CTR', sortable: true, align: 'right' },
  { key: 'position', label: 'Avg Position', sortable: true, align: 'right' },
]

const pageColumns: DataTableColumn[] = [
  { key: 'page', label: 'Page URL', sortable: true },
  { key: 'impressions', label: 'Impressions', sortable: true, align: 'right' },
  { key: 'clicks', label: 'Clicks', sortable: true, align: 'right' },
  { key: 'ctr', label: 'CTR', sortable: true, align: 'right' },
  { key: 'position', label: 'Avg Position', sortable: true, align: 'right' },
]

export default async function SeoPage() {
  const data = await getSeoData()

  const queryRows = data.topQueries.map((row) => ({
    query: row.query,
    impressions: formatNumber(row.impressions),
    clicks: formatNumber(row.clicks),
    ctr: formatPercent(row.ctr),
    position: row.position.toFixed(1),
  }))

  const pageRows = data.topPages.map((row) => ({
    page: row.page,
    impressions: formatNumber(row.impressions),
    clicks: formatNumber(row.clicks),
    ctr: formatPercent(row.ctr),
    position: row.position.toFixed(1),
  }))

  return (
    <div>
      <Header title="SEO Performance" />

      {/* KPI cards row — pass iconName strings, not components */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard
          title="Total Impressions"
          value={formatNumber(data.totalImpressions.value)}
          change={data.totalImpressions.change}
          trend={getTrend(data.totalImpressions.change)}
          iconName="search"
        />
        <KPICard
          title="Total Clicks"
          value={formatNumber(data.totalClicks.value)}
          change={data.totalClicks.change}
          trend={getTrend(data.totalClicks.change)}
          iconName="mouse-pointer-click"
        />
        <KPICard
          title="Avg CTR"
          value={formatPercent(data.avgCtr.value)}
          change={data.avgCtr.change}
          trend={getTrend(data.avgCtr.change)}
          iconName="trending-up"
        />
        <KPICard
          title="Avg Position"
          value={data.avgPosition.value.toFixed(1)}
          change={data.avgPosition.change}
          trend={getTrend(-data.avgPosition.change)}
          iconName="globe"
        />
      </div>

      {/* Impressions vs Clicks trend */}
      <div className="mb-6">
        <AreaChart
          data={data.impressionsClicksTrend}
          title="Impressions vs Clicks (Last 30 Days)"
          color="#01A6FA"
          secondaryColor="#E5B897"
          seriesLabel="Impressions"
          secondarySeriesLabel="Clicks"
          height={320}
        />
      </div>

      {/* Top queries table */}
      <div className="mb-6">
        <DataTable
          columns={queryColumns}
          data={queryRows}
          title="Top Queries"
          emptyMessage="No query data available for this period."
        />
      </div>

      {/* Top pages table */}
      <div className="mb-6">
        <DataTable
          columns={pageColumns}
          data={pageRows}
          title="Top Pages"
          emptyMessage="No page data available for this period."
        />
      </div>

      {/* CTR trend + position distribution */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <LineChart
          data={data.ctrTrend}
          title="CTR Trend"
          color="#01A6FA"
          height={300}
        />
        <BarChart
          data={data.positionDistribution}
          title="Position Distribution"
          color="#01A6FA"
          height={300}
          layout="vertical"
        />
      </div>
    </div>
  )
}
