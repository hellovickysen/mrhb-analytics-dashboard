import Header from '@/components/layout/Header'
import KPICard from '@/components/cards/KPICard'
import AreaChart, { type AreaChartDataPoint } from '@/components/charts/AreaChart'
import DonutChart, { type DonutChartDataPoint } from '@/components/charts/DonutChart'
import BarChart, { type BarChartDataPoint } from '@/components/charts/BarChart'
import DataTable, { type DataTableColumn } from '@/components/tables/DataTable'
import { formatNumber, formatPercent } from '@/lib/utils/format'

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------
// This is a Server Component. In production this would read GA4 revenue
// events (purchase, in_app_purchase, and the custom MRHB product events) that
// have been synced into the `revenue` / `transaction` tables, e.g.:
//
//   import { createClient } from '@/lib/supabase/server'
//   const supabase = createClient()
//   const { data } = await supabase
//     .from('revenue')
//     .select('*')
//     .order('date', { ascending: true })
//     .limit(30)
//
// For now we return mock data so the UI structure can be reviewed before the
// GA4 revenue rollup is finalized.

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

async function getRevenueData(): Promise<RevenueData> {
  // TODO: replace with real GA4 / Supabase revenue query once the
  // `revenue` and `transaction` tables are populated from the event sync job.
  // Returning mock data in the same shape for now.
  return {
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
