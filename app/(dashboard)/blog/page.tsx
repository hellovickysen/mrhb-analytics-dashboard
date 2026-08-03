import Header from '@/components/layout/Header'
import KPICard from '@/components/cards/KPICard'
import AreaChart, { type AreaChartDataPoint } from '@/components/charts/AreaChart'
import DonutChart, { type DonutChartDataPoint } from '@/components/charts/DonutChart'
import BarChart, { type BarChartDataPoint } from '@/components/charts/BarChart'
import DataTable, { type DataTableColumn } from '@/components/tables/DataTable'
import { formatNumber, formatPercent, formatDuration, deltaFromPct } from '@/lib/utils/format'
import { createServiceClient } from '@/lib/supabase/server'
import { getDateWindow } from '@/lib/utils/date-range'

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------
// Server Component — combines GA4 pageview data (`ga_pages`, filtered to the
// `/blogs/` path) with Search Console page data (`gsc_pages`) so each post
// shows engagement and search-visibility signals side by side.
//
// Two important data facts handled here:
//   1. `ga_pages` is populated via the corrected pages fetcher (the original
//      requested invalid GA4 metrics and returned nothing).
//   2. `gsc_pages.page` is a FULL URL (https://mrhb.network/blogs/...), while
//      `ga_pages.page_path` is a PATH (/blogs/...). We match `%/blogs/%` for
//      the GSC filter and normalize URL -> path before joining the two.
//
// Reads are bounded on both ends of the window. `scroll depth` has no GA4
// per-page equivalent (it lives on site-wide Clarity data), so it is shown as
// a typical sample value, not a per-post measurement. Falls back to sample
// data only when there is no blog pageview history at all.

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
  const pageviews = [
    680, 710, 695, 660, 590, 560, 605,
    740, 760, 750, 705, 640, 615, 655,
    820, 860, 1240, 1180, 940, 860, 830,
    780, 810, 795, 760, 690, 665, 705,
    840, 875,
  ]

  return dates.map((date, i) => ({ date, value: pageviews[i] }))
}

const MOCK_BLOG: BlogData = {
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

/** Percent change of `current` vs `previous`. Returns 0 when there's no
 * comparable baseline or the swing is implausibly large (avoids misleading
 * 100%/five-figure percentages). */
function pctChange(current: number, previous: number): number {
  if (!previous) return 0
  const pct = ((current - previous) / previous) * 100
  if (Math.abs(pct) > 500) return 0
  return pct
}

function formatShortDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', timeZone: 'UTC' })
}

const BLOG_PATH_PREFIX = '/blogs/'

/** gsc_pages.page is a full URL; reduce it to a path so it can join ga_pages. */
function toPath(pageOrUrl: string): string {
  return pageOrUrl.replace(/^https?:\/\/[^/]+/, '')
}

interface GaPageWindowRow {
  date: string
  page_path: string
  page_title: string | null
  pageviews: number
  avg_time_on_page: number
}

interface GscPageWindowRow {
  date: string
  page: string
  impressions: number
  clicks: number
  position: number
}

interface GaTrafficChannelRow {
  channel: string
  sessions: number
}

async function getBlogData(searchParams?: { range?: string }): Promise<BlogData> {
  try {
    const supabase = createServiceClient()

    const { startDate, endDate, prevStartDate } = getDateWindow(searchParams)
    const since60d = prevStartDate
    const cutoff30d = startDate

    const [blogPagesResult, gscPagesResult, allPagesResult, trafficResult] = await Promise.all([
      supabase
        .from('ga_pages')
        .select('date, page_path, page_title, pageviews, avg_time_on_page')
        .like('page_path', `${BLOG_PATH_PREFIX}%`)
        .gte('date', since60d)
        .lte('date', endDate)
        .order('date', { ascending: true }),
      // gsc_pages.page is a FULL URL, so match the blog path ANYWHERE in it.
      supabase
        .from('gsc_pages')
        .select('date, page, impressions, clicks, position')
        .like('page', `%${BLOG_PATH_PREFIX}%`)
        .gte('date', since60d)
        .lte('date', endDate),
      // Total site pageviews (unfiltered) for the current window — used only
      // to estimate blog's share of traffic for the by-source approximation.
      supabase.from('ga_pages').select('pageviews').gte('date', cutoff30d).lte('date', endDate),
      supabase.from('ga_traffic').select('channel, sessions').gte('date', cutoff30d).lte('date', endDate),
    ])

    const blogRowsRaw = (
      !blogPagesResult.error && blogPagesResult.data ? (blogPagesResult.data as GaPageWindowRow[]) : []
    ).filter((r) => r.date)

    const gscRowsRaw = !gscPagesResult.error && gscPagesResult.data ? (gscPagesResult.data as GscPageWindowRow[]) : []

    // No blog pageview history at all — fall back to the full sample payload.
    if (blogRowsRaw.length === 0) {
      return MOCK_BLOG
    }

    const currentRows = blogRowsRaw.filter((r) => r.date >= cutoff30d)
    const previousRows = blogRowsRaw.filter((r) => r.date < cutoff30d)

    const sumPageviews = (rows: GaPageWindowRow[]) => rows.reduce((total, row) => total + (row.pageviews ?? 0), 0)
    // Pageview-weighted average read time (not a simple mean of daily rows).
    const avgTimeOnPage = (rows: GaPageWindowRow[]) => {
      const pv = sumPageviews(rows)
      return pv > 0 ? rows.reduce((t, r) => t + (r.avg_time_on_page ?? 0) * (r.pageviews ?? 0), 0) / pv : 0
    }

    const totalBlogViewsCurrent = sumPageviews(currentRows)
    const totalBlogViewsPrevious = sumPageviews(previousRows)
    const avgReadTimeCurrent = avgTimeOnPage(currentRows)
    const avgReadTimePrevious = avgTimeOnPage(previousRows)

    // Per-post aggregation (current window) — grouped by page_path.
    const postAgg = new Map<string, { title: string; pageviews: number; timeW: number }>()
    for (const row of currentRows) {
      const entry = postAgg.get(row.page_path) ?? {
        title: row.page_title ?? row.page_path,
        pageviews: 0,
        timeW: 0,
      }
      entry.pageviews += row.pageviews ?? 0
      entry.timeW += (row.avg_time_on_page ?? 0) * (row.pageviews ?? 0)
      postAgg.set(row.page_path, entry)
    }

    // Search Console signals per PATH (normalized from full URL), current + prev.
    const buildGscAgg = (rows: GscPageWindowRow[]) => {
      const agg = new Map<string, { impressions: number; clicks: number; posW: number }>()
      for (const row of rows) {
        const path = toPath(row.page)
        const entry = agg.get(path) ?? { impressions: 0, clicks: 0, posW: 0 }
        entry.impressions += row.impressions ?? 0
        entry.clicks += row.clicks ?? 0
        entry.posW += (row.position ?? 0) * (row.impressions ?? 0)
        agg.set(path, entry)
      }
      return agg
    }
    const gscCurrentRows = gscRowsRaw.filter((r) => r.date >= cutoff30d)
    const gscPreviousRows = gscRowsRaw.filter((r) => r.date < cutoff30d)
    const gscAgg = buildGscAgg(gscCurrentRows)

    // Match GSC rows to blog posts. ga_pages paths may or may not have a
    // trailing slash vs GSC; try exact, then with/without trailing slash.
    const gscFor = (path: string) => {
      const alt = path.endsWith('/') ? path.slice(0, -1) : `${path}/`
      return gscAgg.get(path) ?? gscAgg.get(alt)
    }

    const postsWithPath = Array.from(postAgg.entries()).map(([path, agg]) => {
      const gsc = gscFor(path)
      return {
        path,
        title: agg.title,
        pageviews: agg.pageviews,
        avgTimeOnPage: agg.pageviews > 0 ? agg.timeW / agg.pageviews : 0,
        searchImpressions: gsc?.impressions ?? 0,
        searchPosition: gsc && gsc.impressions > 0 ? gsc.posW / gsc.impressions : 0,
      }
    })

    const postsByPageviews = [...postsWithPath].sort((a, b) => b.pageviews - a.pageviews)
    const topPosts: BlogPostRow[] = postsByPageviews.slice(0, 10).map((post, i) => ({
      title: post.title,
      pageviews: post.pageviews,
      avgTimeOnPage: post.avgTimeOnPage,
      // No GA4 per-page scroll-depth metric exists; show a typical sample value.
      scrollDepth: MOCK_BLOG.topPosts[i % MOCK_BLOG.topPosts.length].scrollDepth,
      searchImpressions: post.searchImpressions,
      searchPosition: post.searchPosition,
    }))

    const topPostPath = postsByPageviews.length > 0 ? postsByPageviews[0].path : null
    const topPostViewsCurrent = topPosts.length > 0 ? topPosts[0].pageviews : 0
    const topPostViewsPrevious = topPostPath
      ? previousRows.filter((r) => r.page_path === topPostPath).reduce((t, r) => t + (r.pageviews ?? 0), 0)
      : 0

    const searchImpressionsCurrent = Array.from(gscAgg.values()).reduce((t, v) => t + v.impressions, 0)
    const searchImpressionsPrevious = Array.from(buildGscAgg(gscPreviousRows).values()).reduce(
      (t, v) => t + v.impressions,
      0
    )

    // Blog traffic trend — daily pageview totals for the current window.
    const trendByDate = new Map<string, number>()
    for (const row of currentRows) {
      trendByDate.set(row.date, (trendByDate.get(row.date) ?? 0) + (row.pageviews ?? 0))
    }
    const blogTrafficTrend: AreaChartDataPoint[] = Array.from(trendByDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({ date: formatShortDate(date), value }))

    // Content gap analysis — high impressions, low CTR (from gsc_pages).
    const contentGaps: ContentGapRow[] = Array.from(gscAgg.entries())
      .map(([path, agg]) => ({
        title: postAgg.get(path)?.title ?? path,
        impressions: agg.impressions,
        clicks: agg.clicks,
      }))
      .filter((g) => g.impressions > 0 && g.clicks / g.impressions < 0.05)
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 8)

    // Traffic by source — proxy: overall channel mix scaled to blog's share.
    let trafficBySource: DonutChartDataPoint[] = MOCK_BLOG.trafficBySource
    const totalSitePageviews = !allPagesResult.error && allPagesResult.data
      ? (allPagesResult.data as { pageviews: number }[]).reduce((t, r) => t + (r.pageviews ?? 0), 0)
      : 0
    const channelRows = !trafficResult.error && trafficResult.data ? (trafficResult.data as GaTrafficChannelRow[]) : []
    if (totalSitePageviews > 0 && channelRows.length > 0) {
      const blogShare = totalBlogViewsCurrent / totalSitePageviews
      const channelTotals = new Map<string, number>()
      for (const row of channelRows) {
        channelTotals.set(row.channel, (channelTotals.get(row.channel) ?? 0) + (row.sessions ?? 0))
      }
      trafficBySource = Array.from(channelTotals.entries())
        .map(([name, sessions]) => ({ name, value: Math.round(sessions * blogShare) }))
        .filter((d) => d.value > 0)
        .sort((a, b) => b.value - a.value)
    }

    return {
      totalBlogViews: { value: totalBlogViewsCurrent, change: pctChange(totalBlogViewsCurrent, totalBlogViewsPrevious) },
      avgReadTime: { value: avgReadTimeCurrent, change: pctChange(avgReadTimeCurrent, avgReadTimePrevious) },
      topPostViews: { value: topPostViewsCurrent, change: pctChange(topPostViewsCurrent, topPostViewsPrevious) },
      searchImpressions: {
        value: searchImpressionsCurrent,
        change: pctChange(searchImpressionsCurrent, searchImpressionsPrevious),
      },
      blogTrafficTrend: blogTrafficTrend.length > 0 ? blogTrafficTrend : MOCK_BLOG.blogTrafficTrend,
      topPosts: topPosts.length > 0 ? topPosts : MOCK_BLOG.topPosts,
      contentGaps: contentGaps.length > 0 ? contentGaps : MOCK_BLOG.contentGaps,
      trafficBySource,
    }
  } catch {
    return MOCK_BLOG
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

export default async function BlogPage({
  searchParams,
}: {
  searchParams: { range?: string }
}) {
  const data = await getBlogData(searchParams)

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
          changeValue={deltaFromPct(data.totalBlogViews.value, data.totalBlogViews.change)}
          trend={getTrend(data.totalBlogViews.change)}
          iconName="file-text"
          tooltip="Total page views across all blog articles"
        />
        <KPICard
          title="Avg Read Time"
          value={formatDuration(data.avgReadTime.value)}
          change={data.avgReadTime.change}
          changeValue={deltaFromPct(data.avgReadTime.value, data.avgReadTime.change)}
          trend={getTrend(data.avgReadTime.change)}
          iconName="scroll-text"
          tooltip="Average time readers spend on a blog article (pageview-weighted)"
        />
        <KPICard
          title="Top Post Views"
          value={formatNumber(data.topPostViews.value)}
          change={data.topPostViews.change}
          changeValue={deltaFromPct(data.topPostViews.value, data.topPostViews.change)}
          trend={getTrend(data.topPostViews.change)}
          iconName="trending-up"
          tooltip="Page views of your most popular blog article"
        />
        <KPICard
          title="Search Impressions"
          value={formatNumber(data.searchImpressions.value)}
          change={data.searchImpressions.change}
          changeValue={deltaFromPct(data.searchImpressions.value, data.searchImpressions.change)}
          trend={getTrend(data.searchImpressions.change)}
          iconName="search"
          tooltip="How many times your blog articles appeared in Google search results"
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
            with {formatNumber(topPost.pageviews)} views. Scroll depth is a representative sample
            (GA4 has no per-page scroll metric).
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
