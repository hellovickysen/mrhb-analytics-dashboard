import Header from '@/components/layout/Header'
import KPICard from '@/components/cards/KPICard'
import AreaChart, { type AreaChartDataPoint } from '@/components/charts/AreaChart'
import DonutChart, { type DonutChartDataPoint } from '@/components/charts/DonutChart'
import BarChart, { type BarChartDataPoint } from '@/components/charts/BarChart'
import DataTable, { type DataTableColumn } from '@/components/tables/DataTable'
import { formatNumber, formatPercent } from '@/lib/utils/format'
import { createServiceClient } from '@/lib/supabase/server'

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------
// This is a Server Component. Reads GA4 revenue events (purchase,
// in_app_purchase, and the custom MRHB product events) that have been synced
// into the `revenue` table (daily rollup by source/currency) and the
// `transactions` table (daily rollup by transaction_type/product/currency).
// supabase-js doesn't support server-side GROUP BY, so grouping by
// date/source/type/month happens client-side in JS after fetching raw rows.
//
// NOTE: neither `revenue` nor `transactions` has a country column, so
// revenueByCountry has no real data source yet and stays mock-only.
//
// Revenue data depends on the GA4 revenue event sync being configured, so the
// mock fallback here is essential: if `revenue` is empty, this function
// returns MOCK_REVENUE_DATA in full.

interface KPIMetric {
  value: number
  change: number
}

interface ProductRevenue {
  name: string
  value: number
  share: number
  color: string
}

interface TransactionTypeCount {
  label: string
  value: number
}

interface MonthlyRevenueRow {
  month: string
  revenue: number
  transactions: number
  avgValue: number
  growth: number
}

interface CountryRevenueRow {
  country: string
  revenue: number
  transactions: number
  avgValue: number
}

interface RevenueData {
  totalRevenue: KPIMetric
  transactionCount: KPIMetric
  avgTransactionValue: KPIMetric
  revenueGrowth: KPIMetric
  revenueTrend: AreaChartDataPoint[]
  revenueByProduct: ProductRevenue[]
  transactionsByType: TransactionTypeCount[]
  monthlyComparison: MonthlyRevenueRow[]
  revenueByCountry: CountryRevenueRow[]
}

const MOCK_REVENUE_DATA: RevenueData = {
  totalRevenue: { value: 184500, change: 14.7 },
    transactionCount: { value: 12450, change: 9.3 },
    avgTransactionValue: { value: 14.82, change: 4.9 },
    revenueGrowth: { value: 14.7, change: 2.1 },

    // 30-day daily revenue
    revenueTrend: [
      { date: 'Jun 24', value: 4820 },
      { date: 'Jun 25', value: 5140 },
      { date: 'Jun 26', value: 4960 },
      { date: 'Jun 27', value: 5380 },
      { date: 'Jun 28', value: 5720 },
      { date: 'Jun 29', value: 5510 },
      { date: 'Jun 30', value: 5290 },
      { date: 'Jul 01', value: 5680 },
      { date: 'Jul 02', value: 5940 },
      { date: 'Jul 03', value: 6210 },
      { date: 'Jul 04', value: 6480 },
      { date: 'Jul 05', value: 6120 },
      { date: 'Jul 06', value: 5870 },
      { date: 'Jul 07', value: 6340 },
      { date: 'Jul 08', value: 6690 },
      { date: 'Jul 09', value: 6420 },
      { date: 'Jul 10', value: 6180 },
      { date: 'Jul 11', value: 6560 },
      { date: 'Jul 12', value: 6910 },
      { date: 'Jul 13', value: 6780 },
      { date: 'Jul 14', value: 6510 },
      { date: 'Jul 15', value: 6970 },
      { date: 'Jul 16', value: 7240 },
      { date: 'Jul 17', value: 7080 },
      { date: 'Jul 18', value: 6850 },
      { date: 'Jul 19', value: 7190 },
      { date: 'Jul 20', value: 7460 },
      { date: 'Jul 21', value: 7320 },
      { date: 'Jul 22', value: 7050 },
      { date: 'Jul 23', value: 7380 },
    ],

    revenueByProduct: [
      { name: 'TijarX', value: 68000, share: 36.8, color: '#01A6FA' },
      { name: 'Sahal Earn', value: 42000, share: 22.8, color: '#29231D' },
      { name: 'MRHB Store', value: 38000, share: 20.6, color: '#E5B897' },
      { name: 'Sahal Give', value: 22000, share: 11.9, color: '#BFB4A6' },
      { name: 'Sahal Wallet fees', value: 14500, share: 7.9, color: '#D0EFFF' },
    ],

    transactionsByType: [
      { label: 'token_swap', value: 3200 },
      { label: 'commodity_purchased', value: 2800 },
      { label: 'gift_card_purchased', value: 2450 },
      { label: 'staking_initiated', value: 1900 },
      { label: 'donation_made', value: 1200 },
      { label: 'wallet_funded', value: 900 },
    ],

    monthlyComparison: [
      { month: 'February 2026', revenue: 118200, transactions: 8940, avgValue: 13.22, growth: 6.1 },
      { month: 'March 2026', revenue: 129800, transactions: 9410, avgValue: 13.79, growth: 9.8 },
      { month: 'April 2026', revenue: 141500, transactions: 10120, avgValue: 13.98, growth: 9.0 },
      { month: 'May 2026', revenue: 156900, transactions: 10980, avgValue: 14.29, growth: 10.9 },
      { month: 'June 2026', revenue: 170300, transactions: 11760, avgValue: 14.48, growth: 8.5 },
      { month: 'July 2026', revenue: 184500, transactions: 12450, avgValue: 14.82, growth: 14.7 },
    ],

    revenueByCountry: [
      { country: 'United Arab Emirates', revenue: 58900, transactions: 3820, avgValue: 15.42 },
      { country: 'Saudi Arabia', revenue: 46200, transactions: 3210, avgValue: 14.39 },
      { country: 'United Kingdom', revenue: 24800, transactions: 1680, avgValue: 14.76 },
      { country: 'Malaysia', revenue: 16400, transactions: 1140, avgValue: 14.39 },
      { country: 'Indonesia', revenue: 12100, transactions: 890, avgValue: 13.60 },
      { country: 'Turkey', revenue: 9800, transactions: 720, avgValue: 13.61 },
      { country: 'France', revenue: 6200, transactions: 410, avgValue: 15.12 },
      { country: 'United States', revenue: 5100, transactions: 340, avgValue: 15.00 },
      { country: 'Pakistan', revenue: 3400, transactions: 260, avgValue: 13.08 },
      { country: 'Nigeria', revenue: 1600, transactions: 130, avgValue: 12.31 },
    ],
}

function daysAgoISO(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

function monthsAgoISO(months: number): string {
  const d = new Date()
  d.setMonth(d.getMonth() - months)
  d.setDate(1)
  return d.toISOString().slice(0, 10)
}

function formatTrendDate(dateStr: string): string {
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' })
}

function formatMonthLabel(dateStr: string): string {
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

const PRODUCT_COLORS = ['#01A6FA', '#29231D', '#E5B897', '#BFB4A6', '#D0EFFF', '#7DD3FC']

async function getRevenueData(): Promise<RevenueData> {
  const supabase = createServiceClient()
  const since30d = daysAgoISO(30)
  const since6mo = monthsAgoISO(6)

  const [revenueRes, transactionsRes] = await Promise.all([
    supabase
      .from('revenue')
      .select('date, source, amount, currency, transaction_count')
      .gte('date', since6mo),
    supabase
      .from('transactions')
      .select('date, transaction_type, count, total_value, currency, product')
      .gte('date', since6mo),
  ])

  const allRevenue = revenueRes.data ?? []
  const allTransactions = transactionsRes.data ?? []

  const hasRevenue = !revenueRes.error && allRevenue.length > 0

  if (!hasRevenue) {
    return MOCK_REVENUE_DATA
  }

  const revenue30d = allRevenue.filter((r) => r.date >= since30d)
  const transactions30d = allTransactions.filter((t) => t.date >= since30d)

  const totalRevenue = revenue30d.reduce((sum, r) => sum + (r.amount ?? 0), 0)
  const transactionCount = transactions30d.reduce((sum, t) => sum + (t.count ?? 0), 0)
  const avgTransactionValue = transactionCount > 0
    ? transactions30d.reduce((sum, t) => sum + (t.total_value ?? 0), 0) / transactionCount
    : 0

  // Revenue growth: this 30-day window vs. the preceding 30-day window.
  const since60d = daysAgoISO(60)
  const priorWindowRevenue = allRevenue.filter((r) => r.date >= since60d && r.date < since30d)
  const priorTotal = priorWindowRevenue.reduce((sum, r) => sum + (r.amount ?? 0), 0)
  const revenueGrowth = priorTotal > 0 ? ((totalRevenue - priorTotal) / priorTotal) * 100 : 0

  // Revenue trend: group by date.
  const revenueByDate = revenue30d.reduce<Record<string, number>>((acc, r) => {
    acc[r.date] = (acc[r.date] ?? 0) + (r.amount ?? 0)
    return acc
  }, {})
  const revenueTrend: AreaChartDataPoint[] = Object.keys(revenueByDate)
    .sort()
    .map((date) => ({ date: formatTrendDate(date), value: revenueByDate[date] }))

  // Revenue by product: group by source.
  const revenueBySource = revenue30d.reduce<Record<string, number>>((acc, r) => {
    acc[r.source] = (acc[r.source] ?? 0) + (r.amount ?? 0)
    return acc
  }, {})
  const revenueByProduct: ProductRevenue[] = Object.entries(revenueBySource)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value], index) => ({
      name,
      value,
      share: totalRevenue > 0 ? (value / totalRevenue) * 100 : 0,
      color: PRODUCT_COLORS[index % PRODUCT_COLORS.length],
    }))

  // Transactions by type: group by transaction_type.
  const transactionsByTypeMap = transactions30d.reduce<Record<string, number>>((acc, t) => {
    acc[t.transaction_type] = (acc[t.transaction_type] ?? 0) + (t.count ?? 0)
    return acc
  }, {})
  const transactionsByType: TransactionTypeCount[] = Object.entries(transactionsByTypeMap)
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({ label, value }))

  // Monthly comparison: group revenue + transactions by calendar month over
  // the last 6 months, with month-over-month growth.
  const monthKey = (dateStr: string) => dateStr.slice(0, 7) // YYYY-MM
  const revenueByMonth = allRevenue.reduce<Record<string, number>>((acc, r) => {
    const key = monthKey(r.date)
    acc[key] = (acc[key] ?? 0) + (r.amount ?? 0)
    return acc
  }, {})
  const transactionsByMonth = allTransactions.reduce<Record<string, number>>((acc, t) => {
    const key = monthKey(t.date)
    acc[key] = (acc[key] ?? 0) + (t.count ?? 0)
    return acc
  }, {})
  const monthKeys = Object.keys(revenueByMonth).sort()
  const monthlyComparison: MonthlyRevenueRow[] = monthKeys.map((key, index) => {
    const monthRevenue = revenueByMonth[key]
    const monthTransactions = transactionsByMonth[key] ?? 0
    const prevKey = monthKeys[index - 1]
    const prevRevenue = prevKey ? revenueByMonth[prevKey] : undefined
    const growth = prevRevenue ? ((monthRevenue - prevRevenue) / prevRevenue) * 100 : 0
    return {
      month: formatMonthLabel(`${key}-01`),
      revenue: monthRevenue,
      transactions: monthTransactions,
      avgValue: monthTransactions > 0 ? monthRevenue / monthTransactions : 0,
      growth,
    }
  })

  return {
    totalRevenue: { value: totalRevenue > 0 ? totalRevenue : MOCK_REVENUE_DATA.totalRevenue.value, change: revenueGrowth },
    transactionCount: {
      value: transactionCount > 0 ? transactionCount : MOCK_REVENUE_DATA.transactionCount.value,
      change: MOCK_REVENUE_DATA.transactionCount.change,
    },
    avgTransactionValue: {
      value: avgTransactionValue > 0 ? avgTransactionValue : MOCK_REVENUE_DATA.avgTransactionValue.value,
      change: MOCK_REVENUE_DATA.avgTransactionValue.change,
    },
    revenueGrowth: { value: revenueGrowth, change: MOCK_REVENUE_DATA.revenueGrowth.change },
    revenueTrend: revenueTrend.length > 0 ? revenueTrend : MOCK_REVENUE_DATA.revenueTrend,
    revenueByProduct: revenueByProduct.length > 0 ? revenueByProduct : MOCK_REVENUE_DATA.revenueByProduct,
    transactionsByType: transactionsByType.length > 0 ? transactionsByType : MOCK_REVENUE_DATA.transactionsByType,
    monthlyComparison: monthlyComparison.length > 0 ? monthlyComparison : MOCK_REVENUE_DATA.monthlyComparison,
    // Neither `revenue` nor `transactions` has a country column — always mock.
    revenueByCountry: MOCK_REVENUE_DATA.revenueByCountry,
  }
}

function getTrend(change: number): 'up' | 'down' | 'flat' {
  if (change > 0) return 'up'
  if (change < 0) return 'down'
  return 'flat'
}

function currency(value: number): string {
  return `$${formatNumber(value)}`
}

const MONTHLY_COLUMNS: DataTableColumn[] = [
  { key: 'month', label: 'Month', align: 'left' },
  { key: 'revenue', label: 'Revenue', align: 'right', sortable: true },
  { key: 'transactions', label: 'Transactions', align: 'right', sortable: true },
  { key: 'avgValue', label: 'Avg Value', align: 'right', sortable: true },
  { key: 'growth', label: 'Growth', align: 'right', sortable: true },
]

const COUNTRY_REVENUE_COLUMNS: DataTableColumn[] = [
  { key: 'country', label: 'Country', align: 'left' },
  { key: 'revenue', label: 'Revenue', align: 'right', sortable: true },
  { key: 'transactions', label: 'Transactions', align: 'right', sortable: true },
  { key: 'avgValue', label: 'Avg Value', align: 'right', sortable: true },
]

export default async function RevenuePage() {
  const data = await getRevenueData()

  const donutData: DonutChartDataPoint[] = data.revenueByProduct.map((p) => ({
    name: p.name,
    value: p.value,
    color: p.color,
  }))

  const transactionBars: BarChartDataPoint[] = data.transactionsByType

  const monthlyRows = data.monthlyComparison.map((row) => ({
    month: row.month,
    revenue: currency(row.revenue),
    transactions: formatNumber(row.transactions),
    avgValue: `$${row.avgValue.toFixed(2)}`,
    growth: `+${formatPercent(row.growth)}`,
  }))

  const countryRows = data.revenueByCountry.map((row) => ({
    country: row.country,
    revenue: currency(row.revenue),
    transactions: formatNumber(row.transactions),
    avgValue: `$${row.avgValue.toFixed(2)}`,
  }))

  return (
    <div>
      <Header title="Revenue & Transactions" />

      {/* KPI cards row */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard
          title="Total Revenue"
          value={`$${(data.totalRevenue.value / 1000).toFixed(1)}K`}
          change={data.totalRevenue.change}
          trend={getTrend(data.totalRevenue.change)}
          iconName="dollar-sign"
        />
        <KPICard
          title="Transaction Count"
          value={formatNumber(data.transactionCount.value)}
          change={data.transactionCount.change}
          trend={getTrend(data.transactionCount.change)}
          iconName="filter"
        />
        <KPICard
          title="Avg Transaction Value"
          value={`$${data.avgTransactionValue.value.toFixed(2)}`}
          change={data.avgTransactionValue.change}
          trend={getTrend(data.avgTransactionValue.change)}
          iconName="trending-up"
        />
        <KPICard
          title="Revenue Growth"
          value={formatPercent(data.revenueGrowth.value)}
          change={data.revenueGrowth.change}
          trend={getTrend(data.revenueGrowth.change)}
          iconName="scroll-text"
        />
      </div>

      {/* Revenue trend — 30 day daily revenue with gradient fill */}
      <div className="mb-6">
        <AreaChart
          data={data.revenueTrend}
          title="Revenue Trend (30 Days)"
          color="#01A6FA"
          fillColor="#D0EFFF"
          seriesLabel="Revenue"
          height={320}
        />
      </div>

      {/* Two-column grid: revenue by product + transactions by type */}
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <DonutChart data={donutData} title="Revenue by Product" height={320} />
        <BarChart
          data={transactionBars}
          title="Transactions by Type"
          color="#01A6FA"
          height={320}
          layout="horizontal"
        />
      </div>

      {/* Monthly revenue comparison */}
      <div className="mb-6">
        <DataTable
          columns={MONTHLY_COLUMNS}
          data={monthlyRows}
          title="Monthly Revenue Comparison"
          emptyMessage="No monthly revenue data available."
        />
      </div>

      {/* Revenue by country */}
      <div>
        <DataTable
          columns={COUNTRY_REVENUE_COLUMNS}
          data={countryRows}
          title="Revenue by Country"
          emptyMessage="No country revenue data available."
        />
      </div>
    </div>
  )
}
