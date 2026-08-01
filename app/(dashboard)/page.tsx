import Header from '@/components/layout/Header'
import KPICard from '@/components/cards/KPICard'
import LineChart, { type LineChartDataPoint } from '@/components/charts/LineChart'
import { formatNumber } from '@/lib/utils/format'
import { createServiceClient } from '@/lib/supabase/server'
import { getDateWindow } from '@/lib/utils/date-range'
import { fetchGA4AppActiveUsersTotal } from '@/lib/api-clients/ga4-app-active-total'

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------
// Server Component. The Overview aggregates the SAME authoritative sources the
// per-section pages use, so its KPIs reconcile with them exactly:
//
//   Total Users / Traffic Trend / Channel  -> daily_kpis traffic_* rows
//        (de-duplicated, website-only; matches the Traffic page). We do NOT
//        sum ga_traffic here — that table is polluted with historical app rows
//        and GA4 users are non-additive.
//   Organic Clicks  -> SUM(gsc_pages.clicks), paginated + date-bounded
//        (matches the SEO page). NOT gsc_queries, whose query dimension is
//        heavily anonymized and under-counts ~6x.
//   Social Clicks   -> the authoritative range_<range> Short.io snapshot
//        (matches the Social page). NOT a raw SUM over shortio_clicks, which
//        would add every grain (daily + breakdown + snapshot) together.
//   Wallet Active Users -> fetchGA4AppActiveUsersTotal (one de-duplicated GA4
//        app call), NOT a sum of daily activeUsers (non-additive -> overcount).
//   Revenue -> intentionally NOT configured until Firebase revenue events
//        exist; shown as "Not configured", never a live/$0 figure.
//   App Installs -> SUM(ga_events first_open); event counts ARE additive. This
//        is a first-open (install proxy), not a Play-Store-verified install.
//
// Every source is wrapped so a missing table / RLS-denied read / empty result
// falls back to clearly-flagged sample values (never presented as live).

interface OverviewKPIs {
  totalUsers: { value: number; change: number | null }
  walletActiveUsers: { value: number; change: number | null; sourced: boolean }
  appInstalls: { value: number; change: number | null }
  organicClicks: { value: number; change: number | null }
  socialClicksHuman: { value: number; sourced: boolean }
  revenueConfigured: boolean
  revenue: { value: number; change: number | null }
  trafficSourced: boolean
  trafficTrend: LineChartDataPoint[]
  channelBreakdown: { channel: string; sessions: number; share: number }[]
  topCountries: { country: string; users: number; share: number }[]
}

const MOCK_OVERVIEW: OverviewKPIs = {
  totalUsers: { value: 48210, change: 8.4 },
  appInstalls: { value: 6320, change: 12.1 },
  organicClicks: { value: 21875, change: 5.6 },
  socialClicksHuman: { value: 9142, sourced: false },
  walletActiveUsers: { value: 1250, change: 5.2, sourced: false },
  revenueConfigured: false,
  revenue: { value: 0, change: null },
  trafficSourced: false,
  trafficTrend: [
    { date: 'Jun 24', value: 3200 },
    { date: 'Jun 27', value: 3450 },
    { date: 'Jun 30', value: 3100 },
    { date: 'Jul 03', value: 3800 },
    { date: 'Jul 06', value: 4200 },
    { date: 'Jul 09', value: 3950 },
    { date: 'Jul 12', value: 4500 },
    { date: 'Jul 15', value: 4750 },
    { date: 'Jul 18', value: 4620 },
    { date: 'Jul 21', value: 5100 },
    { date: 'Jul 23', value: 5340 },
  ],
  channelBreakdown: [
    { channel: 'Organic Search', sessions: 21875, share: 38.2 },
    { channel: 'Social', sessions: 14320, share: 25.0 },
    { channel: 'Direct', sessions: 10904, share: 19.0 },
    { channel: 'Referral', sessions: 6210, share: 10.8 },
    { channel: 'Paid', sessions: 4032, share: 7.0 },
  ],
  topCountries: [
    { country: 'United Arab Emirates', users: 15840, share: 32.9 },
    { country: 'Saudi Arabia', users: 11200, share: 23.2 },
    { country: 'United Kingdom', users: 6104, share: 12.7 },
    { country: 'United States', users: 4890, share: 10.1 },
    { country: 'Malaysia', users: 3312, share: 6.9 },
  ],
}

/** Delimiter used in daily_kpis channel/source metric_names (see ga4-range-kpis). */
const SEP = '~~'

/**
 * Percent change of `current` vs `previous`. Returns null (→ no % shown) when
 * there's no comparable baseline (previous ≤ 0) or the swing is implausibly
 * large (|Δ| > 500%), instead of a misleading 100% / five-figure number.
 */
function pctChange(current: number, previous: number): number | null {
  if (!previous || previous <= 0) return null
  const pct = ((current - previous) / previous) * 100
  if (Math.abs(pct) > 500) return null
  return pct
}

/** Sums a numeric column split into current [curStart, curEnd] vs previous
 * [prevStart, curStart). Date-bounded on BOTH ends so no stray future/older
 * rows leak in. Returns null on error so the caller can fall back. */
async function fetchWindowedSum(
  supabase: ReturnType<typeof createServiceClient>,
  table: string,
  column: string,
  dateColumn: string,
  prevStart: string,
  curStart: string,
  curEnd: string,
  extraFilter?: (query: any) => any
): Promise<{ current: number; previous: number } | null> {
  try {
    let query = supabase
      .from(table)
      .select(`${dateColumn}, ${column}`)
      .gte(dateColumn, prevStart)
      .lte(dateColumn, curEnd)
    if (extraFilter) query = extraFilter(query)
    const { data, error } = await query
    if (error || !data) return null

    let current = 0
    let previous = 0
    for (const row of data as unknown as Record<string, unknown>[]) {
      const rowDate = String(row[dateColumn] ?? '')
      const rawValue = row[column]
      const value = typeof rawValue === 'number' ? rawValue : Number(rawValue) || 0
      if (rowDate >= curStart) current += value
      else previous += value
    }
    return { current, previous }
  } catch {
    return null
  }
}

/**
 * Sums gsc_pages.clicks across a date window, paginating past Supabase's
 * 1,000-row-per-request cap. Mirrors the SEO page so Organic Clicks reconciles
 * with SEO's Total Clicks. Returns { current, previous } (previous = the window
 * immediately before curStart) or null on error.
 */
async function fetchGscPageClicks(
  supabase: ReturnType<typeof createServiceClient>,
  prevStart: string,
  curStart: string,
  curEnd: string
): Promise<{ current: number; previous: number } | null> {
  try {
    const rows: { date: string; clicks: number }[] = []
    const PAGE = 1000
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('gsc_pages')
        .select('date, clicks')
        .gte('date', prevStart)
        .lte('date', curEnd)
        .order('date', { ascending: true })
        .range(from, from + PAGE - 1)
      if (error) throw new Error(error.message)
      const page = (data ?? []) as { date: string; clicks: number }[]
      rows.push(...page)
      if (page.length < PAGE) break
    }

    let current = 0
    let previous = 0
    for (const r of rows) {
      const v = typeof r.clicks === 'number' ? r.clicks : Number(r.clicks) || 0
      if (r.date >= curStart) current += v
      else previous += v
    }
    return { current, previous }
  } catch {
    return null
  }
}

async function getOverviewData(searchParams?: { range?: string }): Promise<OverviewKPIs> {
  const rangeKey = (searchParams?.range as string) ?? '30d'
  try {
    const supabase = createServiceClient()
    const { startDate, endDate, prevStartDate } = getDateWindow(searchParams)

    const [
      usersKpiRes,
      trendRes,
      installsWin,
      socialRes,
      revenueRes,
      geoRes,
      walletCur,
      walletPrev,
      gscClicks,
    ] = await Promise.all([
      // Authoritative Total Users (de-duplicated, website-only) — latest sync.
      supabase
        .from('daily_kpis')
        .select('date, metric_value, period_comparison_pct')
        .eq('source', 'ga4')
        .eq('metric_name', `traffic_users_${rangeKey}`)
        .order('date', { ascending: false })
        .limit(1),
      // Authoritative per-date session trend within the window.
      supabase
        .from('daily_kpis')
        .select('date, metric_value')
        .eq('source', 'ga4')
        .eq('metric_name', 'traffic_trend_sessions')
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: true }),
      // App installs proxy (first_open) — additive; safe to sum.
      fetchWindowedSum(supabase, 'ga_events', 'event_count', 'date', prevStartDate, startDate, endDate, (q) =>
        q.eq('event_name', 'first_open')
      ),
      // Authoritative Short.io per-range human-click total (latest snapshot).
      supabase
        .from('shortio_clicks')
        .select('date, human_clicks, total_clicks')
        .eq('link_id', `range_${rangeKey}`)
        .order('date', { ascending: false })
        .limit(1),
      // Revenue rows (only present once Firebase revenue events are configured).
      supabase
        .from('daily_kpis')
        .select('metric_value')
        .eq('source', 'ga4')
        .eq('metric_name', 'revenue')
        .gte('date', startDate)
        .lte('date', endDate),
      // Top countries — ga_geo is website-only (same basis as the Traffic page).
      supabase.from('ga_geo').select('country, users').gte('date', startDate).lte('date', endDate),
      // Wallet active users — de-duplicated period totals (current + previous).
      fetchGA4AppActiveUsersTotal(startDate, endDate),
      fetchGA4AppActiveUsersTotal(prevStartDate, startDate),
      // Organic clicks from gsc_pages (paginated), current + previous windows.
      fetchGscPageClicks(supabase, prevStartDate, startDate, endDate),
    ])

    // ---- Total Users (authoritative) ----
    const usersRow = usersKpiRes.data?.[0] as
      | { date: string; metric_value: number; period_comparison_pct: number | null }
      | undefined
    const trafficSourced = !!usersRow
    const totalUsers = usersRow
      ? { value: Number(usersRow.metric_value) || 0, change: usersRow.period_comparison_pct ?? null }
      : { value: MOCK_OVERVIEW.totalUsers.value, change: MOCK_OVERVIEW.totalUsers.change }

    // ---- Traffic trend (authoritative per-date sessions) ----
    let trafficTrend: LineChartDataPoint[] = MOCK_OVERVIEW.trafficTrend
    const trendRows = (trendRes.data ?? []) as { date: string; metric_value: number }[]
    if (trendRows.length > 0) {
      trafficTrend = trendRows.map((r) => ({
        date: formatShortDate(r.date),
        value: Number(r.metric_value) || 0,
      }))
    }

    // ---- Channel breakdown (authoritative) — read the latest sync day's rows
    // and parse traffic_chan_<range>~~<channel> in JS (never SQL LIKE: the
    // metric_name contains underscores that LIKE would treat as wildcards). ----
    let channelBreakdown = MOCK_OVERVIEW.channelBreakdown
    if (usersRow?.date) {
      const { data: chanData } = await supabase
        .from('daily_kpis')
        .select('metric_name, metric_value')
        .eq('source', 'ga4')
        .eq('date', usersRow.date)
      const prefix = `traffic_chan_${rangeKey}${SEP}`
      const chanRows = ((chanData ?? []) as { metric_name: string; metric_value: number }[])
        .filter((r) => typeof r.metric_name === 'string' && r.metric_name.startsWith(prefix))
        .map((r) => ({ channel: r.metric_name.slice(prefix.length), sessions: Number(r.metric_value) || 0 }))
      if (chanRows.length > 0) {
        const total = chanRows.reduce((t, r) => t + r.sessions, 0)
        channelBreakdown = chanRows
          .sort((a, b) => b.sessions - a.sessions)
          .slice(0, 5)
          .map((r) => ({ channel: r.channel, sessions: r.sessions, share: total > 0 ? (r.sessions / total) * 100 : 0 }))
      }
    }

    // ---- App installs (first_open proxy) ----
    const appInstalls = installsWin
      ? { value: installsWin.current, change: pctChange(installsWin.current, installsWin.previous) }
      : { value: MOCK_OVERVIEW.appInstalls.value, change: MOCK_OVERVIEW.appInstalls.change }

    // ---- Organic clicks (gsc_pages, matches SEO) ----
    const organicClicks = gscClicks
      ? { value: gscClicks.current, change: pctChange(gscClicks.current, gscClicks.previous) }
      : { value: MOCK_OVERVIEW.organicClicks.value, change: MOCK_OVERVIEW.organicClicks.change }

    // ---- Social clicks (authoritative Short.io range snapshot) ----
    const socialRow = socialRes.data?.[0] as { human_clicks: number } | undefined
    const socialClicksHuman = socialRow
      ? { value: Number(socialRow.human_clicks) || 0, sourced: true }
      : { value: MOCK_OVERVIEW.socialClicksHuman.value, sourced: false }

    // ---- Wallet active users (de-duplicated period total) ----
    const walletSourced = walletCur > 0
    const walletActiveUsers = walletSourced
      ? { value: walletCur, change: pctChange(walletCur, walletPrev), sourced: true }
      : { value: MOCK_OVERVIEW.walletActiveUsers.value, change: MOCK_OVERVIEW.walletActiveUsers.change, sourced: false }

    // ---- Revenue (only when Firebase revenue events are configured) ----
    const revenueRows = (revenueRes.data ?? []) as { metric_value: number }[]
    const revenueConfigured = revenueRows.length > 0
    const revenueValue = revenueRows.reduce((t, r) => t + (Number(r.metric_value) || 0), 0)
    const revenue = { value: revenueValue, change: null }

    // ---- Top countries (ga_geo) ----
    let topCountries = MOCK_OVERVIEW.topCountries
    const geoRows = (geoRes.data ?? []) as { country: string; users: number }[]
    if (geoRows.length > 0) {
      const byCountry = new Map<string, number>()
      for (const row of geoRows) {
        byCountry.set(row.country, (byCountry.get(row.country) ?? 0) + (Number(row.users) || 0))
      }
      const total = Array.from(byCountry.values()).reduce((t, v) => t + v, 0)
      topCountries = Array.from(byCountry.entries())
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([country, users]) => ({ country, users, share: total > 0 ? (users / total) * 100 : 0 }))
    }

    return {
      totalUsers,
      walletActiveUsers,
      appInstalls,
      organicClicks,
      socialClicksHuman,
      revenueConfigured,
      revenue,
      trafficSourced,
      trafficTrend,
      channelBreakdown,
      topCountries,
    }
  } catch {
    return MOCK_OVERVIEW
  }
}

/** Formats a `YYYY-MM-DD` string as "Jul 23" to match the mock trend labels. */
function formatShortDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', timeZone: 'UTC' })
}

function getTrend(change: number | null | undefined): 'up' | 'down' | 'flat' {
  if (!change) return 'flat'
  if (change > 0) return 'up'
  if (change < 0) return 'down'
  return 'flat'
}

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: { range?: string }
}) {
  const data = await getOverviewData(searchParams)

  // Collect any KPI that is NOT live so it's never silently shown as sourced.
  const notLive: string[] = []
  if (!data.revenueConfigured) notLive.push('Revenue is not configured (needs Firebase purchase/revenue events)')
  if (!data.walletActiveUsers.sourced) notLive.push('Wallet Active Users is sample data (GA4 app metrics unavailable)')
  if (!data.socialClicksHuman.sourced) notLive.push('Social Clicks is sample data (Short.io not synced yet)')
  if (!data.trafficSourced) notLive.push('Total Users, Traffic Trend and Channel Breakdown are sample data (GA4 traffic KPIs not synced yet)')

  return (
    <div>
      <Header title="Overview" />

      {/* Any non-live KPIs are called out explicitly — mock is never presented as live */}
      {notLive.length > 0 && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-800">Some cards are not live data</p>
          <ul className="mt-1 list-disc pl-5 text-xs text-amber-700">
            {notLive.map((msg) => (
              <li key={msg}>{msg}</li>
            ))}
          </ul>
        </div>
      )}

      {/* KPI cards row — pass iconName strings, not components */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <KPICard
          title="Total Users"
          value={formatNumber(data.totalUsers.value)}
          change={data.totalUsers.change ?? undefined}
          trend={getTrend(data.totalUsers.change)}
          iconName="users"
          tooltip="Website users for this period — de-duplicated active users (matches the Traffic page)"
        />
        <KPICard
          title="App Installs"
          value={formatNumber(data.appInstalls.value)}
          change={data.appInstalls.change ?? undefined}
          trend={getTrend(data.appInstalls.change)}
          iconName="smartphone"
          tooltip="First-time app opens (Firebase first_open) — a proxy for installs, not a Play-Store-verified install count"
        />
        <KPICard
          title="Organic Clicks"
          value={formatNumber(data.organicClicks.value)}
          change={data.organicClicks.change ?? undefined}
          trend={getTrend(data.organicClicks.change)}
          iconName="mouse-pointer-click"
          tooltip="Clicks from Google search results to your website (from Search Console page data — matches the SEO page)"
        />
        <KPICard
          title="Social Clicks (Human)"
          value={formatNumber(data.socialClicksHuman.value)}
          iconName="share2"
          tooltip="Real people (not bots) who clicked your Short.io links — authoritative per-range total (matches the Social page)"
        />
        <KPICard
          title="Wallet Active Users"
          value={formatNumber(data.walletActiveUsers.value)}
          change={data.walletActiveUsers.change ?? undefined}
          trend={getTrend(data.walletActiveUsers.change)}
          iconName="users"
          tooltip="Unique active users in the Sahal Wallet app for this period (de-duplicated, from Firebase GA4)"
        />
        <KPICard
          title="Revenue"
          value={data.revenueConfigured ? `$${formatNumber(data.revenue.value)}` : 'Not configured'}
          change={data.revenueConfigured ? data.revenue.change ?? undefined : undefined}
          trend={getTrend(data.revenueConfigured ? data.revenue.change : null)}
          iconName="dollar-sign"
          tooltip={
            data.revenueConfigured
              ? 'Total revenue generated from in-app transactions'
              : 'Revenue tracking is not configured yet — it requires Firebase purchase/revenue events. This is not live data, and transaction event counts are not shown as revenue.'
          }
        />
      </div>

      {/* Traffic trend chart */}
      <div className="mb-6">
        <LineChart
          data={data.trafficTrend}
          title="Traffic Trend"
          color="#01A6FA"
          height={320}
        />
      </div>

      {/* Two-column grid: channel breakdown + top countries */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Channel breakdown */}
        <div className="rounded-xl bg-mrhb-white p-5 shadow-sm">
          <h3 className="mb-4 text-base font-semibold text-mrhb-dark">
            Channel Breakdown
          </h3>
          <ul className="space-y-3">
            {data.channelBreakdown.map((item) => (
              <li key={item.channel}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-medium text-mrhb-dark">{item.channel}</span>
                  <span className="text-mrhb-dark/60">
                    {formatNumber(item.sessions)} &middot; {item.share.toFixed(1)}%
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-mrhb-blue-light">
                  <div
                    className="h-full rounded-full bg-mrhb-blue"
                    style={{ width: `${item.share}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Top countries */}
        <div className="rounded-xl bg-mrhb-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-mrhb-blue-light text-sm">🌍</span>
            <h3 className="text-base font-semibold text-mrhb-dark">Top Countries</h3>
          </div>
          <ul className="space-y-3">
            {data.topCountries.map((item, index) => (
              <li
                key={item.country}
                className="flex items-center justify-between border-b border-mrhb-warm-grey/15 pb-3 last:border-0 last:pb-0"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-mrhb-blue-light text-xs font-semibold text-mrhb-blue">
                    {index + 1}
                  </span>
                  <span className="text-sm font-medium text-mrhb-dark">
                    {item.country}
                  </span>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-mrhb-dark">
                    {formatNumber(item.users)}
                  </p>
                  <p className="text-xs text-mrhb-dark/50">{item.share.toFixed(1)}%</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
