import Header from '@/components/layout/Header'
import KPICard from '@/components/cards/KPICard'
import AreaChart, { type AreaChartDataPoint } from '@/components/charts/AreaChart'
import DonutChart, { type DonutChartDataPoint } from '@/components/charts/DonutChart'
import BarChart, { type BarChartDataPoint } from '@/components/charts/BarChart'
import DataTable, { type DataTableColumn } from '@/components/tables/DataTable'
import { formatNumber, formatPercent, formatDuration } from '@/lib/utils/format'

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------
// This is a Server Component. In production this combines GA4 pageview data
// (`ga_page`, filtered to the `/blogs/` path — see lib/types/index.ts
// `GAPage`) with Search Console query/page data (`gsc_page` — see
// `GSCPage`) so each post shows both engagement and search-visibility
// signals side by side, e.g.:
//
//   import { createClient } from '@/lib/supabase/server'
//   const supabase = createClient()
//
//   // Blog traffic trend (30-day, filtered to /blogs/ path)
//   const { data: trend } = await supabase
//     .from('ga_page')
//     .select('date, pageviews.sum()')
//     .like('page_path', '/blogs/%')
//     .gte('date', thirtyDaysAgo)
//     .group('date')
//     .order('date', { ascending: true })
//
//   // Per-post GA4 engagement, joined with GSC search performance for the
//   // same page_path/page — typically materialized as a view since it spans
//   // two source tables:
//   const { data: posts } = await supabase
//     .from('blog_post_performance')  // materialized view: ga_page x gsc_page
//     .select('page_path, page_title, pageviews, avg_time_on_page, scroll_depth_pct, impressions, position')
//     .gte('date', thirtyDaysAgo)
//     .order('pageviews', { ascending: false })
//     .limit(10)
//
//   // Content gap analysis — posts with high impressions but low clicks
//   // (i.e., ranking but not converting to traffic), via the same view:
//   const { data: gaps } = await supabase
//     .from('blog_post_performance')
//     .select('page_title, impressions, clicks')
//     .gte('date', thirtyDaysAgo)
//     .order('impressions', { ascending: false })
//     .filter('clicks_to_impressions_ratio', 'lt', 0.02)
//     .limit(8)
//
//   // Traffic by source, filtered to /blogs/ path
//   const { data: sourceBreakdown } = await supabase
//     .from('ga_traffic')
//     .select('channel, sessions.sum()')
//     .like('landing_page_path', '/blogs/%')
//     .gte('date', thirtyDaysAgo)
//     .group('channel')
//
// For now we return mock data in the same shape so the UI can be reviewed
// before the materialized view joining GA4 + GSC is built.

interface BlogPostRow {
  title: string
  pageviews: number
  avgTimeOnPage: number
  scrollDepth: number
  searchImpressions: number
  searchPosition: number
}

interface ContentGapRow {
  title: string
  impressions: number
  clicks: number
}

interface BlogData {
  totalBlogViews: { value: number; change: number }
  avgReadTime: { value: number; change: number }
  topPostViews: { value: number; change: number }
  searchImpressions: { value: number; change: number }
  blogTrafficTrend: AreaChartDataPoint[]
  topPosts: BlogPostRow[]
  contentGaps: ContentGapRow[]
  trafficBySource: DonutChartDataPoint[]
}

function buildBlogTrafficTrend(): AreaChartDataPoint[] {
  const dates = [
    'Jun 24', 'Jun 25', 'Jun 26', 'Jun 27', 'Jun 28', 'Jun 29', 'Jun 30',
    'Jul 01', 'Jul 02', 'Jul 03', 'Jul 04', 'Jul 05', 'Jul 06', 'Jul 07',
    'Jul 08', 'Jul 09', 'Jul 10', 'Jul 11', 'Jul 12', 'Jul 13', 'Jul 14',
    'Jul 15', 'Jul 16', 'Jul 17', 'Jul 18', 'Jul 19', 'Jul 20', 'Jul 21',
    'Jul 22', 'Jul 23',
  ]
  // Blog pageviews (filtered to /blogs/) — smaller volume than total site
  // traffic, with a visible bump around Jul 15 from a "Halal DeFi Explained"
  // social share spike.
  const pageviews = [
    680, 710, 695, 660, 590, 560, 605,
    740, 760, 750, 705, 640, 615, 655,
    820, 860, 1240, 1180, 940, 860, 830,
    780, 810, 795, 760, 690, 665, 705,
    840, 875,
  ]

  return dates.map((date, i) => ({ date, value: pageviews[i] }))
}

async function getBlogData(): Promise<BlogData> {
  // TODO: replace mock data with the Supabase queries outlined above once
  // the `blog_post_performance` materialized view (joining `ga_page` and
  // `gsc_page`) is built.
  return {
    totalBlogViews: { value: 23180, change: 16.4 },
    avgReadTime: { value: 214, change: 8.9 },
    topPostViews: { value: 4360, change: 22.7 },
    searchImpressions: { value: 118940, change: 11.3 },
    blogTrafficTrend: buildBlogTrafficTrend(),
    topPosts: [
      {
        title: 'What Is Halal Fintech?',
        pageviews: 4360,
        avgTimeOnPage: 246,
        scrollDepth: 71.4,
        searchImpressions: 18420,
        searchPosition: 4.2,
      },
      {
        title: 'Is Crypto Halal or Haram? A Complete Guide',
        pageviews: 3980,
        avgTimeOnPage: 268,
        scrollDepth: 68.9,
        searchImpressions: 22140,
        searchPosition: 9.8,
      },
      {
        title: 'Halal DeFi Explained: Can Decentralized Finance Be Sharia-Compliant?',
        pageviews: 3720,
        avgTimeOnPage: 291,
        scrollDepth: 74.2,
        searchImpressions: 12480,
        searchPosition: 8.3,
      },
      {
        title: 'Zakat Calculator: How to Calculate Your Zakat in 2026',
        pageviews: 2860,
        avgTimeOnPage: 198,
        scrollDepth: 63.1,
        searchImpressions: 19420,
        searchPosition: 10.2,
      },
      {
        title: 'Sharia-Compliant Savings Accounts: What to Look For',
        pageviews: 2340,
        avgTimeOnPage: 227,
        scrollDepth: 66.8,
        searchImpressions: 8740,
        searchPosition: 7.6,
      },
      {
        title: 'Is Bitcoin Haram? Scholars Weigh In',
        pageviews: 2010,
        avgTimeOnPage: 203,
        scrollDepth: 61.5,
        searchImpressions: 27340,
        searchPosition: 15.8,
      },
      {
        title: 'Halal Staking: Earning Rewards the Sharia-Compliant Way',
        pageviews: 1580,
        avgTimeOnPage: 235,
        scrollDepth: 69.7,
        searchImpressions: 9680,
        searchPosition: 13.2,
      },
      {
        title: 'How Sahal Wallet Makes Halal Investing Accessible',
        pageviews: 1120,
        avgTimeOnPage: 179,
        scrollDepth: 58.3,
        searchImpressions: 5210,
        searchPosition: 6.4,
      },
      {
        title: 'Halal P2P Lending: A Beginner’s Guide',
        pageviews: 780,
        avgTimeOnPage: 211,
        scrollDepth: 64.0,
        searchImpressions: 9120,
        searchPosition: 14.6,
      },
      {
        title: 'Sadaqah Coin: Turning Charity Into an On-Chain Habit',
        pageviews: 430,
        avgTimeOnPage: 165,
        scrollDepth: 52.7,
        searchImpressions: 4890,
        searchPosition: 4.6,
      },
    ],
    // Content gap analysis: posts ranking well in impressions but converting
    // very few of those impressions into clicks — prime candidates for
    // title/meta-description or on-page CTR optimization.
    contentGaps: [
      { title: 'Is Bitcoin Haram? Scholars Weigh In', impressions: 27340, clicks: 610 },
      { title: 'Is Crypto Halal or Haram? A Complete Guide', impressions: 22140, clicks: 780 },
      { title: 'Zakat Calculator: How to Calculate Your Zakat in 2026', impressions: 19420, clicks: 890 },
      { title: 'What Is Halal Fintech?', impressions: 18420, clicks: 1240 },
      { title: 'Islamic Fintech Companies to Watch in 2026', impressions: 11960, clicks: 340 },
      { title: 'Halal DeFi Explained', impressions: 12480, clicks: 610 },
      { title: 'Halal Staking: Earning Rewards the Sharia-Compliant Way', impressions: 9680, clicks: 290 },
      { title: 'Halal P2P Lending: A Beginner’s Guide', impressions: 9120, clicks: 280 },
    ],
    trafficBySource: [
      { name: 'Organic', value: 13640 },
      { name: 'Social', value: 6280 },
      { name: 'Direct', value: 2140 },
      { name: 'Referral', value: 1120 },
    ],
  }
}

function getTrend(change: number): 'up' | 'down' | 'flat' {
  if (change > 0) return 'up'
  if (change < 0) return 'down'
  return 'flat'
}

interface TopPostTableRow {
  title: string
  pageviews: string
  avgTimeOnPage: string
  scrollDepth: string
  searchImpressions: string
  searchPosition: string
}

const topPostColumns: DataTableColumn[] = [
  { key: 'title', label: 'Title', sortable: true },
  { key: 'pageviews', label: 'Pageviews', sortable: true, align: 'right' },
  { key: 'avgTimeOnPage', label: 'Avg Time on Page', sortable: true, align: 'right' },
  { key: 'scrollDepth', label: 'Scroll Depth', sortable: true, align: 'right' },
  { key: 'searchImpressions', label: 'Search Impressions', sortable: true, align: 'right' },
  { key: 'searchPosition', label: 'Search Position', sortable: true, align: 'right' },
]

export default async function BlogPage() {
  const data = await getBlogData()

  const topPostRows: TopPostTableRow[] = data.topPosts.map((row) => ({
    title: row.title,
    pageviews: formatNumber(row.pageviews),
    avgTimeOnPage: formatDuration(row.avgTimeOnPage),
    scrollDepth: formatPercent(row.scrollDepth),
    searchImpressions: formatNumber(row.searchImpressions),
    searchPosition: row.searchPosition.toFixed(1),
  }))

  const contentGapChartData: BarChartDataPoint[] = data.contentGaps.map((row) => ({
    label: row.title.length > 32 ? `${row.title.slice(0, 32)}…` : row.title,
    value: row.impressions,
    secondaryValue: row.clicks,
  }))

  const topPost = data.topPosts[0]

  return (
    <div>
      <Header title="Blog Performance" />

      {/* KPI cards row — pass iconName strings, not components */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard
          title="Total Blog Views"
          value={formatNumber(data.totalBlogViews.value)}
          change={data.totalBlogViews.change}
          trend={getTrend(data.totalBlogViews.change)}
          iconName="file-text"
        />
        <KPICard
          title="Avg Read Time"
          value={formatDuration(data.avgReadTime.value)}
          change={data.avgReadTime.change}
          trend={getTrend(data.avgReadTime.change)}
          iconName="scroll-text"
        />
        <KPICard
          title="Top Post Views"
          value={formatNumber(data.topPostViews.value)}
          change={data.topPostViews.change}
          trend={getTrend(data.topPostViews.change)}
          iconName="trending-up"
        />
        <KPICard
          title="Search Impressions"
          value={formatNumber(data.searchImpressions.value)}
          change={data.searchImpressions.change}
          trend={getTrend(data.searchImpressions.change)}
          iconName="search"
        />
      </div>

      {/* Blog traffic trend (filtered to /blogs/ path) */}
      <div className="mb-6">
        <AreaChart
          data={data.blogTrafficTrend}
          title="Blog Traffic Trend (Last 30 Days)"
          color="#01A6FA"
          height={320}
        />
      </div>

      {/* Top posts table */}
      <div className="mb-6">
        <DataTable
          columns={topPostColumns}
          data={topPostRows}
          title="Top Posts"
          emptyMessage="No blog post data available for this period."
        />
        {topPost && (
          <p className="mt-3 text-xs text-mrhb-dark/50">
            Leading post: <span className="font-medium text-mrhb-dark/70">{topPost.title}</span>{' '}
            with {formatNumber(topPost.pageviews)} views and {formatPercent(topPost.scrollDepth)} average scroll depth.
          </p>
        )}
      </div>

      {/* Content gap analysis + traffic by source */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <BarChart
          data={contentGapChartData}
          title="Content Gap Analysis (High Impressions, Low Clicks)"
          color="#E5B897"
          secondaryColor="#01A6FA"
          valueLabel="Impressions"
          secondaryValueLabel="Clicks"
          height={340}
          layout="horizontal"
        />
        <DonutChart
          data={data.trafficBySource}
          title="Blog Traffic by Source"
          height={300}
        />
      </div>
    </div>
  )
}
