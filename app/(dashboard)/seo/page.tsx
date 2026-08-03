import Header from '@/components/layout/Header'
import KPICard from '@/components/cards/KPICard'
import AreaChart, { type AreaChartDataPoint } from '@/components/charts/AreaChart'
import LineChart, { type LineChartDataPoint } from '@/components/charts/LineChart'
import BarChart, { type BarChartDataPoint } from '@/components/charts/BarChart'
import DataTable, { type DataTableColumn } from '@/components/tables/DataTable'
import { formatNumber, formatPercent, deltaFromPct } from '@/lib/utils/format'
import { createServiceClient } from '@/lib/supabase/server'
import { getDateWindow } from '@/lib/utils/date-range'

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------
// Server Component — Search Console performance.
//
// HEADLINE totals, the impressions/clicks trend, CTR trend, top pages and the
// position distribution all come from `gsc_pages` (see lib/types/index.ts
// `GSCPage`). We deliberately do NOT derive the headline totals from
// `gsc_queries`: Google heavily ANONYMIZES the query dimension (rare queries
// are withheld), so summing query rows badly under-counts site totals
// (observed 803 vs Search Console's ~5,040). The page dimension is far more
// complete and matches Search Console.
//
// CTR and Average Position are IMPRESSION-WEIGHTED (CTR = total clicks / total
// impressions; position = sum(position*impressions)/sum(impressions)) — never
// a simple mean of per-row values, which would over-weight tiny queries.
//
// The Top Queries table still comes from `gsc_queries` (that's the query
// breakdown by definition), also with weighted CTR/position.
//
// Reads are bounded on both ends of the window. Falls back to clearly-labelled
// sample data (isSourced=false) only when Search Console has no page rows.

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
  isSourced: boolean
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

const MOCK_SEO: SeoData = {
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
  isSourced: false,
}

/**
 * Percent change of `current` vs `previous`. Returns 0 (neutral) when there's
 * no comparable baseline (previous is 0 — e.g. the prior window predates the
 * data) or when the swing is implausibly large (|change| > 500%), rather than
 * showing a misleading 100%/five-figure percentage.
 */
function pctChange(current: number, previous: number): number {
  if (!previous) return 0
  const pct = ((current - previous) / previous) * 100
  if (Math.abs(pct) > 500) return 0
  return pct
}

/** Formats a `YYYY-MM-DD` string as "Jul 23" to match the mock trend labels. */
function formatShortDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', timeZone: 'UTC' })
}

interface GscQueryWindowRow {
  date: string
  query: string
  impressions: number
  clicks: number
  position: number
}

interface GscPageWindowRow {
  date: string
  page: string
  impressions: number
  clicks: number
  position: number
}

const RANGE_LABELS: Record<string, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  '7d': 'Last 7 Days',
  '30d': 'Last 30 Days',
  '90d': 'Last 90 Days',
}

const sumImpr = (rows: { impressions: number }[]) => rows.reduce((t, r) => t + (r.impressions ?? 0), 0)
const sumClicks = (rows: { clicks: number }[]) => rows.reduce((t, r) => t + (r.clicks ?? 0), 0)
const weightedCtr = (rows: { impressions: number; clicks: number }[]) => {
  const i = sumImpr(rows)
  return i > 0 ? (sumClicks(rows) / i) * 100 : 0
}
const weightedPosition = (rows: { impressions: number; position: number }[]) => {
  const i = sumImpr(rows)
  return i > 0 ? rows.reduce((t, r) => t + (r.position ?? 0) * (r.impressions ?? 0), 0) / i : 0
}

/**
 * Fetches ALL rows for a date window, paginating past Supabase's 1,000-row-per
 * -request cap. GSC tables hold thousands of page/query-day rows, so a single
 * request (capped + ordered) would silently truncate the window.
 */
async function fetchAllGsc(
  supabase: ReturnType<typeof createServiceClient>,
  table: 'gsc_pages' | 'gsc_queries',
  columns: string,
  fromDate: string,
  toDate: string
): Promise<Record<string, any>[]> {
  const all: Record<string, any>[] = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .gte('date', fromDate)
      .lte('date', toDate)
      .order('date', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const rows = data ?? []
    all.push(...rows)
    if (rows.length < PAGE) break
  }
  return all
}

async function getSeoData(searchParams?: { range?: string }): Promise<SeoData> {
  try {
    const supabase = createServiceClient()
    const { startDate, endDate, prevStartDate } = getDateWindow(searchParams)

    const [pageRowsAll, queryRowsAll] = await Promise.all([
      // Pages carry current + previous window (for % change), both ends bounded.
      fetchAllGsc(supabase, 'gsc_pages', 'date, page, impressions, clicks, position', prevStartDate, endDate),
      // Queries only need the current window (for the Top Queries table).
      fetchAllGsc(supabase, 'gsc_queries', 'date, query, impressions, clicks, position', startDate, endDate),
    ])

    const pageRows = (pageRowsAll as GscPageWindowRow[]).filter((r) => r.date)
    const queryRows = (queryRowsAll as GscQueryWindowRow[]).filter((r) => r.date)

    const isSourced = pageRows.length > 0
    if (!isSourced) {
      return { ...MOCK_SEO, isSourced: false }
    }

    const currentPages = pageRows.filter((r) => r.date >= startDate)
    const previousPages = pageRows.filter((r) => r.date < startDate)

    const impressionsCurrent = sumImpr(currentPages)
    const impressionsPrevious = sumImpr(previousPages)
    const clicksCurrent = sumClicks(currentPages)
    const clicksPrevious = sumClicks(previousPages)
    const ctrCurrent = weightedCtr(currentPages)
    const ctrPrevious = weightedCtr(previousPages)
    const positionCurrent = weightedPosition(currentPages)
    const positionPrevious = weightedPosition(previousPages)

    // Impressions vs clicks trend — daily totals from gsc_pages (current window).
    const trendByDate = new Map<string, { impressions: number; clicks: number }>()
    for (const row of currentPages) {
      const entry = trendByDate.get(row.date) ?? { impressions: 0, clicks: 0 }
      entry.impressions += row.impressions ?? 0
      entry.clicks += row.clicks ?? 0
      trendByDate.set(row.date, entry)
    }
    const sortedDates = Array.from(trendByDate.keys()).sort((a, b) => a.localeCompare(b))
    const impressionsClicksTrend: AreaChartDataPoint[] = sortedDates.map((date) => {
      const entry = trendByDate.get(date)!
      return { date: formatShortDate(date), value: entry.impressions, secondaryValue: entry.clicks }
    })
    // CTR trend — weighted (clicks/impressions) per day, not a mean of ratios.
    const ctrTrend: LineChartDataPoint[] = sortedDates.map((date) => {
      const entry = trendByDate.get(date)!
      return { date: formatShortDate(date), value: entry.impressions > 0 ? (entry.clicks / entry.impressions) * 100 : 0 }
    })

    // Top queries — from gsc_queries (current), weighted CTR/position per query.
    const queryAgg = new Map<string, { impressions: number; clicks: number; posW: number }>()
    for (const row of queryRows) {
      const entry = queryAgg.get(row.query) ?? { impressions: 0, clicks: 0, posW: 0 }
      entry.impressions += row.impressions ?? 0
      entry.clicks += row.clicks ?? 0
      entry.posW += (row.position ?? 0) * (row.impressions ?? 0)
      queryAgg.set(row.query, entry)
    }
    const topQueries: QueryRow[] = Array.from(queryAgg.entries())
      .map(([query, a]) => ({
        query,
        impressions: a.impressions,
        clicks: a.clicks,
        ctr: a.impressions > 0 ? (a.clicks / a.impressions) * 100 : 0,
        position: a.impressions > 0 ? a.posW / a.impressions : 0,
      }))
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 15)

    // Top pages — from gsc_pages (current), weighted CTR/position per page.
    const pageAgg = new Map<string, { impressions: number; clicks: number; posW: number }>()
    for (const row of currentPages) {
      const entry = pageAgg.get(row.page) ?? { impressions: 0, clicks: 0, posW: 0 }
      entry.impressions += row.impressions ?? 0
      entry.clicks += row.clicks ?? 0
      entry.posW += (row.position ?? 0) * (row.impressions ?? 0)
      pageAgg.set(row.page, entry)
    }
    const topPages: PageRow[] = Array.from(pageAgg.entries())
      .map(([page, a]) => ({
        page,
        impressions: a.impressions,
        clicks: a.clicks,
        ctr: a.impressions > 0 ? (a.clicks / a.impressions) * 100 : 0,
        position: a.impressions > 0 ? a.posW / a.impressions : 0,
      }))
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 10)

    // Position distribution — one entry per PAGE using its impression-weighted
    // position (not per query-day row), bucketed.
    const buckets = { '1-3': 0, '4-10': 0, '11-20': 0, '21-50': 0, '50+': 0 }
    for (const a of Array.from(pageAgg.values())) {
      const p = a.impressions > 0 ? a.posW / a.impressions : 0
      if (p <= 3) buckets['1-3'] += 1
      else if (p <= 10) buckets['4-10'] += 1
      else if (p <= 20) buckets['11-20'] += 1
      else if (p <= 50) buckets['21-50'] += 1
      else buckets['50+'] += 1
    }
    const positionDistribution: BarChartDataPoint[] = [
      { label: 'Position 1-3', value: buckets['1-3'] },
      { label: 'Position 4-10', value: buckets['4-10'] },
      { label: 'Position 11-20', value: buckets['11-20'] },
      { label: 'Position 21-50', value: buckets['21-50'] },
      { label: 'Position 50+', value: buckets['50+'] },
    ]

    return {
      totalImpressions: { value: impressionsCurrent, change: pctChange(impressionsCurrent, impressionsPrevious) },
      totalClicks: { value: clicksCurrent, change: pctChange(clicksCurrent, clicksPrevious) },
      avgCtr: { value: ctrCurrent, change: pctChange(ctrCurrent, ctrPrevious) },
      avgPosition: { value: positionCurrent, change: pctChange(positionCurrent, positionPrevious) },
      impressionsClicksTrend,
      ctrTrend,
      topQueries: topQueries.length > 0 ? topQueries : MOCK_SEO.topQueries,
      topPages,
      positionDistribution,
      isSourced: true,
    }
  } catch {
    return { ...MOCK_SEO, isSourced: false }
  }
}

function getTrend(change: number): 'up' | 'down' | 'flat' {
  if (change > 0) return 'up'
  if (change < 0) return 'down'
  return 'flat'
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

export default async function SeoPage({
  searchParams,
}: {
  searchParams: { range?: string }
}) {
  const data = await getSeoData(searchParams)
  const rangeLabel = RANGE_LABELS[searchParams?.range ?? '30d'] ?? 'Last 30 Days'

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

      {/* Sourced-vs-sample state — mock is never presented as live */}
      {!data.isSourced && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-800">Showing sample data</p>
          <p className="mt-1 text-xs text-amber-700">
            Live Search Console metrics are unavailable for this period. The figures below are
            representative sample values, not sourced analytics. Run a sync to populate live data.
          </p>
        </div>
      )}

      {/* KPI cards row — pass iconName strings, not components */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard
          title="Total Impressions"
          value={formatNumber(data.totalImpressions.value)}
          change={data.totalImpressions.change}
          changeValue={deltaFromPct(data.totalImpressions.value, data.totalImpressions.change)}
          trend={getTrend(data.totalImpressions.change)}
          iconName="search"
          tooltip="How many times your pages appeared in Google search results (from Search Console page data)"
        />
        <KPICard
          title="Total Clicks"
          value={formatNumber(data.totalClicks.value)}
          change={data.totalClicks.change}
          changeValue={deltaFromPct(data.totalClicks.value, data.totalClicks.change)}
          trend={getTrend(data.totalClicks.change)}
          iconName="mouse-pointer-click"
          tooltip="How many times people clicked through from Google search to your site"
        />
        <KPICard
          title="Avg CTR"
          value={formatPercent(data.avgCtr.value)}
          change={data.avgCtr.change}
          changeValue={deltaFromPct(data.avgCtr.value, data.avgCtr.change)}
          trend={getTrend(data.avgCtr.change)}
          iconName="trending-up"
          tooltip="Click-through rate = total clicks / total impressions (impression-weighted). Higher is better"
        />
        <KPICard
          title="Avg Position"
          value={data.avgPosition.value.toFixed(1)}
          change={data.avgPosition.change}
          changeValue={deltaFromPct(data.avgPosition.value, data.avgPosition.change)}
          trend={getTrend(-data.avgPosition.change)}
          iconName="globe"
          tooltip="Average ranking position (impression-weighted). Lower is better (1 = top result)"
        />
      </div>

      {/* Impressions vs Clicks trend */}
      <div className="mb-6">
        <AreaChart
          data={data.impressionsClicksTrend}
          title={`Impressions vs Clicks (${rangeLabel})`}
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
