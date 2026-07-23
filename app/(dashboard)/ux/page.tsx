import Header from '@/components/layout/Header'
import KPICard from '@/components/cards/KPICard'
import LineChart, { type LineChartDataPoint } from '@/components/charts/LineChart'
import DonutChart, { type DonutChartDataPoint } from '@/components/charts/DonutChart'
import DataTable, { type DataTableColumn } from '@/components/tables/DataTable'
import { formatPercent, formatDuration } from '@/lib/utils/format'

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------
// This is a Server Component. In production this reads from Microsoft
// Clarity's aggregate session-quality data (`ClaritySession`) and per-page
// friction signals (`ClarityFriction`) — see lib/types/index.ts — e.g.:
//
//   import { createClient } from '@/lib/supabase/server'
//   const supabase = createClient()
//
//   const { data: sessionQuality } = await supabase
//     .from('clarity_sessions')
//     .select('date, scroll_depth_pct, active_time_sec, total_time_sec, pages_per_session, new_user_pct')
//     .order('date', { ascending: true })
//     .limit(7)
//
//   const { data: friction } = await supabase
//     .from('clarity_friction')
//     .select('page_url, dead_clicks_pct, dead_clicks_sessions, rage_clicks_pct, rage_clicks_sessions, excessive_scrolling_pct, quick_backs_pct')
//     .order('date', { ascending: false })
//
// For now we return mock data in the same shape so the UI can be reviewed
// before the Clarity export/sync job is wired up.

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

async function getUXData(): Promise<UXData> {
  // TODO: replace mock data with the Supabase queries outlined above once
  // the Clarity export/sync job is live.
  return {
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

export default async function UXPage() {
  const data = await getUXData()

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
        />
        <KPICard
          title="Active Time"
          value={formatDuration(data.activeTime.value)}
          change={data.activeTime.change}
          trend={getTrend(data.activeTime.change)}
          iconName="clock"
        />
        <KPICard
          title="Pages / Session"
          value={data.pagesPerSession.value.toFixed(2)}
          change={data.pagesPerSession.change}
          trend={getTrend(data.pagesPerSession.change)}
          iconName="file-text"
        />
        <KPICard
          title="Dead Click Rate"
          value={formatPercent(data.deadClickRate.value)}
          change={data.deadClickRate.change}
          trend={getTrend(-data.deadClickRate.change)}
          iconName="mouse-pointer-click"
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
