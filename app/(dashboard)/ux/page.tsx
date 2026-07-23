import Header from '@/components/layout/Header'
import KPICard from '@/components/cards/KPICard'
import LineChart, { type LineChartDataPoint } from '@/components/charts/LineChart'
import DonutChart, { type DonutChartDataPoint } from '@/components/charts/DonutChart'
import DataTable, { type DataTableColumn } from '@/components/tables/DataTable'
import { formatPercent, formatDuration } from '@/lib/utils/format'
import { createServiceClient } from '@/lib/supabase/server'
import { getDateWindow } from '@/lib/utils/date-range'

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------
// This is a Server Component. Reads Microsoft Clarity's aggregate
// session-quality data (`clarity_sessions`) and per-page friction signals
// (`clarity_friction`). Falls back to mock data (in the same shape) whenever
// either table has no rows yet, so the UI stays reviewable before the
// Clarity export/sync job is live.

interface FrictionAlert {
  label: string
  valuePct: number
  status: 'healthy' | 'attention'
  detail: string
}

interface PageFrictionRow {
  pageUrl: string
  deadClicksPct: number
  rageClicksPct: number
  scrollDepthPct: number
  activeTimeSec: number
}

interface UXData {
  scrollDepth: { value: number; change: number }
  activeTime: { value: number; change: number }
  pagesPerSession: { value: number; change: number }
  deadClickRate: { value: number; change: number }
  frictionAlerts: FrictionAlert[]
  totalTimeSec: number
  newUserPct: number
  scrollDepthTrend: LineChartDataPoint[]
  topPagesByFriction: PageFrictionRow[]
}

const MOCK_UX_DATA: UXData = {
  scrollDepth: { value: 43.1, change: -1.8 },
  activeTime: { value: 19, change: 2.4 },
  pagesPerSession: { value: 1.15, change: -0.6 },
  deadClickRate: { value: 10, change: 1.2 },
  frictionAlerts: [
    {
      label: 'Rage Clicks',
      valuePct: 0,
      status: 'healthy',
      detail: 'No sessions showed repeated rapid clicking on the same element.',
    },
    {
      label: 'Dead Clicks',
      valuePct: 10,
      status: 'attention',
      detail: '2 sessions affected — elements may look clickable but aren’t.',
    },
    {
      label: 'Excessive Scrolling',
      valuePct: 0,
      status: 'healthy',
      detail: 'No sessions showed erratic back-and-forth scrolling behavior.',
    },
    {
      label: 'Quick Backs',
      valuePct: 0,
      status: 'healthy',
      detail: 'No sessions bounced back to the previous page within seconds.',
    },
  ],
  totalTimeSec: 84,
  newUserPct: 100,
  scrollDepthTrend: [
    { date: 'Jul 17', value: 46.8 },
    { date: 'Jul 18', value: 45.2 },
    { date: 'Jul 19', value: 44.6 },
    { date: 'Jul 20', value: 42.9 },
    { date: 'Jul 21', value: 41.5 },
    { date: 'Jul 22', value: 42.3 },
    { date: 'Jul 23', value: 43.1 },
  ],
  topPagesByFriction: [
    { pageUrl: '/', deadClicksPct: 12.4, rageClicksPct: 0, scrollDepthPct: 38.6, activeTimeSec: 14 },
    { pageUrl: '/sahal-wallet', deadClicksPct: 9.8, rageClicksPct: 0, scrollDepthPct: 51.2, activeTimeSec: 26 },
    { pageUrl: '/blogs', deadClicksPct: 7.1, rageClicksPct: 0, scrollDepthPct: 58.4, activeTimeSec: 31 },
    { pageUrl: '/about', deadClicksPct: 5.6, rageClicksPct: 0, scrollDepthPct: 44.9, activeTimeSec: 18 },
    { pageUrl: '/tijarx', deadClicksPct: 10.9, rageClicksPct: 0, scrollDepthPct: 35.7, activeTimeSec: 12 },
  ],
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

function formatTrendDate(dateStr: string): string {
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

async function getUXData(searchParams?: { range?: string }): Promise<UXData> {
  const supabase = createServiceClient()
  const { startDate: since } = getDateWindow(searchParams)

  const sessionsRes = await supabase
    .from('clarity_sessions')
    .select(
      'date, scroll_depth_pct, active_time_sec, total_time_sec, pages_per_session, new_user_pct'
    )
    .gte('date', since)
    .order('date', { ascending: true })

  const frictionRes = await supabase
    .from('clarity_friction')
    .select(
      'date, page_url, dead_clicks_pct, dead_clicks_sessions, rage_clicks_pct, rage_clicks_sessions, excessive_scrolling_pct, excessive_scrolling_sessions, quick_backs_pct, quick_backs_sessions'
    )
    .order('date', { ascending: false })

  const sessions = sessionsRes.data ?? []
  const friction = frictionRes.data ?? []

  const hasSessions = !sessionsRes.error && sessions.length > 0
  const hasFriction = !frictionRes.error && friction.length > 0

  if (!hasSessions || !hasFriction) {
    return MOCK_UX_DATA
  }

  const previousSession = sessions.length > 1 ? sessions[sessions.length - 2] : null

  const scrollDepthValue = average(sessions.map((s) => s.scroll_depth_pct ?? 0))
  const activeTimeValue = average(sessions.map((s) => s.active_time_sec ?? 0))
  const pagesPerSessionValue = average(sessions.map((s) => s.pages_per_session ?? 0))
  const totalTimeSecValue = average(sessions.map((s) => s.total_time_sec ?? 0))
  const newUserPctValue = average(sessions.map((s) => s.new_user_pct ?? 0))

  const changePct = (current: number, previous: number | null | undefined): number => {
    if (!previous) return 0
    return ((current - previous) / previous) * 100
  }

  // Latest site-wide friction row (page_url === 'ALL') for the alert cards;
  // fall back to the most recent row of any kind if no 'ALL' row exists yet.
  const latestFriction = friction.find((f) => f.page_url === 'ALL') ?? friction[0]
  const deadClickRateValue = latestFriction?.dead_clicks_pct ?? 0

  const frictionAlerts: FrictionAlert[] = [
    {
      label: 'Rage Clicks',
      valuePct: latestFriction?.rage_clicks_pct ?? 0,
      status: (latestFriction?.rage_clicks_pct ?? 0) > 0 ? 'attention' : 'healthy',
      detail:
        (latestFriction?.rage_clicks_sessions ?? 0) > 0
          ? `${latestFriction?.rage_clicks_sessions} session(s) showed repeated rapid clicking on the same element.`
          : 'No sessions showed repeated rapid clicking on the same element.',
    },
    {
      label: 'Dead Clicks',
      valuePct: latestFriction?.dead_clicks_pct ?? 0,
      status: (latestFriction?.dead_clicks_pct ?? 0) > 0 ? 'attention' : 'healthy',
      detail:
        (latestFriction?.dead_clicks_sessions ?? 0) > 0
          ? `${latestFriction?.dead_clicks_sessions} session(s) affected — elements may look clickable but aren’t.`
          : 'No sessions showed elements that look clickable but aren’t.',
    },
    {
      label: 'Excessive Scrolling',
      valuePct: latestFriction?.excessive_scrolling_pct ?? 0,
      status: (latestFriction?.excessive_scrolling_pct ?? 0) > 0 ? 'attention' : 'healthy',
      detail:
        (latestFriction?.excessive_scrolling_sessions ?? 0) > 0
          ? `${latestFriction?.excessive_scrolling_sessions} session(s) showed erratic back-and-forth scrolling behavior.`
          : 'No sessions showed erratic back-and-forth scrolling behavior.',
    },
    {
      label: 'Quick Backs',
      valuePct: latestFriction?.quick_backs_pct ?? 0,
      status: (latestFriction?.quick_backs_pct ?? 0) > 0 ? 'attention' : 'healthy',
      detail:
        (latestFriction?.quick_backs_sessions ?? 0) > 0
          ? `${latestFriction?.quick_backs_sessions} session(s) bounced back to the previous page within seconds.`
          : 'No sessions bounced back to the previous page within seconds.',
    },
  ]

  const scrollDepthTrend: LineChartDataPoint[] = sessions
    .slice(-7)
    .map((s) => ({ date: formatTrendDate(s.date), value: s.scroll_depth_pct ?? 0 }))

  // Top pages by friction: group clarity_friction by page_url (excluding the
  // site-wide 'ALL' aggregate row), joined against the matching day's
  // site-wide session metrics for scroll depth / active time context.
  const byPage = new Map<
    string,
    { deadClicksPct: number; rageClicksPct: number; count: number }
  >()
  for (const row of friction) {
    if (row.page_url === 'ALL') continue
    const existing = byPage.get(row.page_url) ?? { deadClicksPct: 0, rageClicksPct: 0, count: 0 }
    existing.deadClicksPct += row.dead_clicks_pct ?? 0
    existing.rageClicksPct += row.rage_clicks_pct ?? 0
    existing.count += 1
    byPage.set(row.page_url, existing)
  }

  const topPagesByFriction: PageFrictionRow[] = Array.from(byPage.entries())
    .map(([pageUrl, agg]) => ({
      pageUrl,
      deadClicksPct: agg.count > 0 ? agg.deadClicksPct / agg.count : 0,
      rageClicksPct: agg.count > 0 ? agg.rageClicksPct / agg.count : 0,
      scrollDepthPct: scrollDepthValue,
      activeTimeSec: activeTimeValue,
    }))
    .sort((a, b) => b.deadClicksPct - a.deadClicksPct)
    .slice(0, 5)

  return {
    scrollDepth: {
      value: scrollDepthValue,
      change: changePct(scrollDepthValue, previousSession?.scroll_depth_pct),
    },
    activeTime: {
      value: activeTimeValue,
      change: changePct(activeTimeValue, previousSession?.active_time_sec),
    },
    pagesPerSession: {
      value: pagesPerSessionValue,
      change: changePct(pagesPerSessionValue, previousSession?.pages_per_session),
    },
    deadClickRate: {
      value: deadClickRateValue,
      change: changePct(deadClickRateValue, latestFriction?.dead_clicks_pct),
    },
    frictionAlerts,
    totalTimeSec: totalTimeSecValue,
    newUserPct: newUserPctValue,
    scrollDepthTrend: scrollDepthTrend.length > 0 ? scrollDepthTrend : MOCK_UX_DATA.scrollDepthTrend,
    topPagesByFriction:
      topPagesByFriction.length > 0 ? topPagesByFriction : MOCK_UX_DATA.topPagesByFriction,
  }
}

function getTrend(change: number): 'up' | 'down' | 'flat' {
  if (change > 0) return 'up'
  if (change < 0) return 'down'
  return 'flat'
}

const ALERT_STYLES: Record<
  FrictionAlert['status'],
  { border: string; bg: string; dot: string; text: string; badge: string }
> = {
  healthy: {
    border: 'border-emerald-200',
    bg: 'bg-emerald-50',
    dot: 'bg-emerald-500',
    text: 'text-emerald-700',
    badge: 'Healthy',
  },
  attention: {
    border: 'border-amber-200',
    bg: 'bg-amber-50',
    dot: 'bg-amber-500',
    text: 'text-amber-700',
    badge: 'Needs Attention',
  },
}

const frictionColumns: DataTableColumn[] = [
  { key: 'pageUrl', label: 'Page', sortable: true },
  { key: 'deadClicksPct', label: 'Dead Clicks %', sortable: true, align: 'right' },
  { key: 'rageClicksPct', label: 'Rage Clicks %', sortable: true, align: 'right' },
  { key: 'scrollDepthPct', label: 'Scroll Depth %', sortable: true, align: 'right' },
  { key: 'activeTime', label: 'Active Time', sortable: true, align: 'right' },
]

export default async function UXPage({
  searchParams,
}: {
  searchParams: { range?: string }
}) {
  const data = await getUXData(searchParams)

  const engagementRatioPct = (data.activeTime.value / data.totalTimeSec) * 100

  const newVsReturningData: DonutChartDataPoint[] = [
    { name: 'New Users', value: data.newUserPct, color: '#01A6FA' },
    { name: 'Returning Users', value: Math.max(0, 100 - data.newUserPct), color: '#BFB4A6' },
  ]

  const frictionRows = data.topPagesByFriction.map((row) => ({
    pageUrl: row.pageUrl,
    deadClicksPct: formatPercent(row.deadClicksPct),
    rageClicksPct: formatPercent(row.rageClicksPct),
    scrollDepthPct: formatPercent(row.scrollDepthPct),
    activeTime: formatDuration(row.activeTimeSec),
  }))

  return (
    <div>
      <Header title="UX Behavior & Friction" />

      {/* KPI cards row — pass iconName strings, not components */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard
          title="Scroll Depth"
          value={formatPercent(data.scrollDepth.value)}
          change={data.scrollDepth.change}
          trend={getTrend(data.scrollDepth.change)}
          iconName="scroll-text"
          tooltip="How far down visitors scroll on your pages on average"
        />
        <KPICard
          title="Active Time"
          value={formatDuration(data.activeTime.value)}
          change={data.activeTime.change}
          trend={getTrend(data.activeTime.change)}
          iconName="clock"
          tooltip="Time visitors actively spend interacting with your site (not idle)"
        />
        <KPICard
          title="Pages / Session"
          value={data.pagesPerSession.value.toFixed(2)}
          change={data.pagesPerSession.change}
          trend={getTrend(data.pagesPerSession.change)}
          iconName="file-text"
          tooltip="Average number of pages a visitor views in one session. Higher means more engagement"
        />
        <KPICard
          title="Dead Click Rate"
          value={formatPercent(data.deadClickRate.value)}
          change={data.deadClickRate.change}
          trend={getTrend(-data.deadClickRate.change)}
          iconName="mouse-pointer-click"
          tooltip="Percentage of sessions where users clicked on non-clickable elements. Indicates confusing UI"
        />
      </div>

      {/* UX Friction Alerts + Engagement Quality */}
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* UX Friction Alerts */}
        <div className="rounded-xl bg-mrhb-white p-5 shadow-sm">
          <h3 className="mb-4 text-base font-semibold text-mrhb-dark">UX Friction Alerts</h3>
          <ul className="space-y-3">
            {data.frictionAlerts.map((alert) => {
              const style = ALERT_STYLES[alert.status]
              return (
                <li
                  key={alert.label}
                  className={`rounded-lg border p-4 ${style.border} ${style.bg}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 rounded-full ${style.dot}`} />
                      <span className="text-sm font-semibold text-mrhb-dark">{alert.label}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-mrhb-dark">
                        {formatPercent(alert.valuePct)}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${style.text} ${style.bg}`}>
                        {style.badge}
                      </span>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-mrhb-dark/70">{alert.detail}</p>
                </li>
              )
            })}
          </ul>
        </div>

        {/* Engagement Quality */}
        <div className="rounded-xl bg-mrhb-white p-5 shadow-sm">
          <h3 className="mb-4 text-base font-semibold text-mrhb-dark">Engagement Quality</h3>

          {/* Active vs total time bar */}
          <div className="mb-5">
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="font-medium text-mrhb-dark">Active Time vs. Total Time</span>
              <span className="text-mrhb-dark/60">
                {formatDuration(data.activeTime.value)} / {formatDuration(data.totalTimeSec)}
              </span>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-mrhb-blue-light">
              <div
                className="h-full rounded-full bg-mrhb-blue"
                style={{ width: `${engagementRatioPct}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-mrhb-dark/50">
              {engagementRatioPct.toFixed(1)}% engagement ratio &mdash; visitors spend most of
              their session idle rather than actively interacting.
            </p>
          </div>

          {/* New vs Returning donut */}
          <div>
            <p className="mb-2 text-sm font-medium text-mrhb-dark">New vs. Returning Users</p>
            <DonutChart data={newVsReturningData} height={220} />
            {data.newUserPct >= 100 && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs font-medium text-amber-700">
                  Zero returning users is concerning &mdash; it suggests visitors aren&apos;t coming
                  back, or that Clarity session/user identification may need to be verified.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Scroll depth trend */}
      <div className="mb-6">
        <LineChart
          data={data.scrollDepthTrend}
          title="Scroll Depth Trend (7-Day)"
          color="#01A6FA"
          height={300}
        />
      </div>

      {/* Top Pages by Friction */}
      <div className="mb-6">
        <DataTable
          columns={frictionColumns}
          data={frictionRows}
          title="Top Pages by Friction"
          emptyMessage="No page-level friction data available for this period."
        />
      </div>

      {/* Action items */}
      <div>
        <h3 className="mb-4 text-base font-semibold text-mrhb-dark">Action Items</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-xl bg-mrhb-white p-5 shadow-sm">
            <p className="mb-1 text-sm font-semibold text-mrhb-dark">
              Investigate Dead Clicks on Homepage & TijarX
            </p>
            <p className="mb-4 text-sm text-mrhb-dark/60">
              Dead clicks are concentrated on <span className="font-medium">/</span> and{' '}
              <span className="font-medium">/tijarx</span>. Watch session recordings to see
              which elements users expect to be interactive.
            </p>
            <a
              href="https://clarity.microsoft.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center rounded-lg bg-mrhb-blue px-4 py-2 text-sm font-medium text-mrhb-white transition-colors hover:bg-mrhb-blue/90"
            >
              View in Clarity Recordings
            </a>
          </div>

          <div className="rounded-xl bg-mrhb-white p-5 shadow-sm">
            <p className="mb-1 text-sm font-semibold text-mrhb-dark">
              Review Low Scroll Depth Pages
            </p>
            <p className="mb-4 text-sm text-mrhb-dark/60">
              <span className="font-medium">/tijarx</span> and{' '}
              <span className="font-medium">/</span> have the lowest scroll depth &mdash; use
              heatmaps to check whether key content is being missed above the fold.
            </p>
            <a
              href="https://clarity.microsoft.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center rounded-lg border border-mrhb-warm-grey/30 bg-mrhb-white px-4 py-2 text-sm font-medium text-mrhb-dark transition-colors hover:bg-mrhb-blue-light"
            >
              View Heatmaps
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
