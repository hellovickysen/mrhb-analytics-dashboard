import Header from '@/components/layout/Header'
import FunnelChart, { type FunnelChartStep } from '@/components/charts/FunnelChart'
import BarChart, { type BarChartDataPoint } from '@/components/charts/BarChart'
import DataTable, { type DataTableColumn } from '@/components/tables/DataTable'
import KPICard from '@/components/cards/KPICard'
import { formatNumber } from '@/lib/utils/format'
import { createServiceClient } from '@/lib/supabase/server'
import { getDateWindow } from '@/lib/utils/date-range'

// ---------------------------------------------------------------------------
// User Journey — a 6-stage acquisition→activation→revenue funnel:
//   Impressions → Clicks → App Installs → 1st Dashboard → 1st Transaction → Revenue
//
// Each stage reads its AUTHORITATIVE source. The three app-event stages
// (Installs / 1st Dashboard / 1st Transaction) are driven by admin-configured
// `tracked_events` rows (funnel_stage + event_name); if none are configured (or
// the 002 migration isn't applied yet) they fall back to built-in event rules.
//
// HONESTY: stages come from DIFFERENT sources and populations — this is a
// cross-source journey, NOT a single tracked cohort (e.g. dashboard/transaction
// count the whole active base, not just this window's installs, so they can
// exceed installs). "1st Dashboard/Transaction" are approximated as
// users-who-reached until dedicated first-time events exist. Sources not yet
// connected (app-store & social impressions, revenue) are shown as
// "Not connected" — never faked. Funnel-bar WIDTH is proportional to each
// stage's value (magnitude), so the shape is honest rather than forced to
// narrow.
// ---------------------------------------------------------------------------

interface StageResult {
  name: string
  value: number
  note: string
  sourced: boolean
}

interface JourneyData {
  stages: StageResult[]
  configured: boolean
  attribution: { platform: string; clicks: number }[]
  ga4SocialSessions: number
}

const APP_STAGE_KEYS = ['App Installs', '1st Dashboard', '1st Transaction']

/** Default event-name rules used when a stage has no admin config. */
function defaultMatch(stage: string, upperName: string): boolean {
  if (stage === 'App Installs') return upperName === 'FIRST_OPEN'
  if (stage === '1st Dashboard') return upperName.indexOf('APP_DASHBOARD') !== -1
  if (stage === '1st Transaction')
    return (
      upperName.indexOf('SEND_MONEY') !== -1 ||
      upperName.indexOf('_SEND_') !== -1 ||
      upperName.indexOf('SWAP') !== -1 ||
      upperName.indexOf('SAHAL_RAMP') !== -1
    )
  return false
}

async function fetchAll(
  supabase: ReturnType<typeof createServiceClient>,
  table: string,
  columns: string,
  since: string,
  until: string,
  maxPages = 40
): Promise<Record<string, any>[]> {
  const all: Record<string, any>[] = []
  const PAGE = 1000
  for (let p = 0; p < maxPages; p++) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .gte('date', since)
      .lte('date', until)
      .order('date', { ascending: true })
      .range(p * PAGE, p * PAGE + PAGE - 1)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as Record<string, any>[]
    all.push(...rows)
    if (rows.length < PAGE) break
  }
  return all
}

async function getJourneyData(searchParams?: { range?: string }): Promise<JourneyData> {
  const rangeKey = (searchParams?.range as string) ?? '30d'
  try {
    const supabase = createServiceClient()
    const { startDate: since, endDate: until } = getDateWindow(searchParams)

    // --- Admin config: which event_names feed each app-event stage ---
    // Resilient to the 002 migration not being applied (funnel_stage missing).
    const configByStage: Record<string, Set<string>> = {
      'App Installs': new Set<string>(),
      '1st Dashboard': new Set<string>(),
      '1st Transaction': new Set<string>(),
    }
    let configured = false
    try {
      const cfg = await supabase
        .from('tracked_events')
        .select('event_name, funnel_stage, is_active')
        .eq('is_active', true)
      if (!cfg.error) {
        for (const r of (cfg.data ?? []) as any[]) {
          const stage = String(r.funnel_stage ?? '')
          if (APP_STAGE_KEYS.indexOf(stage) !== -1 && r.event_name) {
            configByStage[stage].add(String(r.event_name))
            configured = true
          }
        }
      }
    } catch {
      // funnel_stage column absent → leave config empty (defaults apply)
    }

    // --- Parallel source reads ---
    const [events, gscRows, shortioRes, revenueRes, bySocialRes, gaSocialRes] = await Promise.all([
      fetchAll(supabase, 'ga_events', 'date, event_name, users, event_count', since, until),
      fetchAll(supabase, 'gsc_pages', 'date, impressions, clicks', since, until),
      supabase
        .from('shortio_clicks')
        .select('total_clicks, human_clicks')
        .eq('link_id', `range_${rangeKey}`)
        .order('date', { ascending: false })
        .limit(1),
      supabase
        .from('daily_kpis')
        .select('metric_value')
        .eq('source', 'ga4')
        .eq('metric_name', 'revenue')
        .gte('date', since)
        .lte('date', until),
      supabase
        .from('shortio_clicks')
        .select('date, link_id, referrer, total_clicks')
        .in('link_id', [`by_social_${rangeKey}`, 'by_social'])
        .order('date', { ascending: false }),
      supabase.from('ga_traffic').select('sessions').gte('date', since).lte('date', until).eq('channel', 'Organic Social'),
    ])

    // --- App-event stages (users) ---
    const appUsers: Record<string, number> = { 'App Installs': 0, '1st Dashboard': 0, '1st Transaction': 0 }
    for (const r of events) {
      const raw = String(r.event_name ?? '')
      const upper = raw.toUpperCase()
      const u = Number(r.users) || 0
      for (const stage of APP_STAGE_KEYS) {
        const names = configByStage[stage]
        const match = names.size > 0 ? names.has(raw) : defaultMatch(stage, upper)
        if (match) appUsers[stage] += u
      }
    }

    // --- Web acquisition (GSC) ---
    let webImpressions = 0
    let webClicks = 0
    for (const r of gscRows) {
      webImpressions += Number(r.impressions) || 0
      webClicks += Number(r.clicks) || 0
    }

    // --- Social clicks (Short.io authoritative range) ---
    const rangeRow = shortioRes.data?.[0] as { total_clicks: number; human_clicks: number } | undefined
    const socialHuman = Number(rangeRow?.human_clicks) || 0

    // --- Revenue (only if configured) ---
    const revenueRows = (revenueRes.data ?? []) as { metric_value: number }[]
    const revenueConfigured = revenueRows.length > 0
    const revenueValue = revenueRows.reduce((s, r) => s + (Number(r.metric_value) || 0), 0)

    const stages: StageResult[] = [
      {
        name: 'Impressions',
        value: webImpressions,
        note: 'Web (Search Console). Social + app-store impressions not connected.',
        sourced: webImpressions > 0,
      },
      {
        name: 'Clicks',
        value: webClicks + socialHuman,
        note: 'Web search clicks + human social clicks (Short.io).',
        sourced: webClicks + socialHuman > 0,
      },
      {
        name: 'App Installs',
        value: appUsers['App Installs'],
        note: configured ? 'first opens · admin-configured events' : 'first opens (first_open) · default',
        sourced: appUsers['App Installs'] > 0,
      },
      {
        name: '1st Dashboard',
        value: appUsers['1st Dashboard'],
        note: 'users who reached dashboard (approx.)',
        sourced: appUsers['1st Dashboard'] > 0,
      },
      {
        name: '1st Transaction',
        value: appUsers['1st Transaction'],
        note: 'users who transacted — send/swap/ramp (approx.)',
        sourced: appUsers['1st Transaction'] > 0,
      },
      {
        name: 'Revenue',
        value: revenueValue,
        note: revenueConfigured ? 'in-app revenue' : 'Not connected — needs Firebase revenue events',
        sourced: revenueConfigured,
      },
    ]

    // --- Attribution (Short.io per-platform clicks, latest snapshot) ---
    const socRows = (bySocialRes.data ?? []) as any[]
    const latest = socRows.reduce((m, r) => (String(r.date) > m ? String(r.date) : m), '')
    const perRange = socRows.filter((r) => r.date === latest && r.link_id === `by_social_${rangeKey}`)
    const fallback = socRows.filter((r) => r.date === latest && r.link_id === 'by_social')
    const chosen = perRange.length > 0 ? perRange : fallback
    const byPlatform = new Map<string, number>()
    for (const r of chosen) {
      const name = String(r.referrer ?? '').trim()
      if (!name) continue
      byPlatform.set(name, (byPlatform.get(name) ?? 0) + (Number(r.total_clicks) || 0))
    }
    const attribution = Array.from(byPlatform.entries())
      .map(([platform, clicks]) => ({ platform, clicks }))
      .sort((a, b) => b.clicks - a.clicks)
    const ga4SocialSessions = (gaSocialRes.data ?? []).reduce((s: number, r: any) => s + (Number(r.sessions) || 0), 0)

    return { stages, configured, attribution, ga4SocialSessions }
  } catch {
    return { stages: [], configured: false, attribution: [], ga4SocialSessions: 0 }
  }
}

const RANGE_LABELS: Record<string, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  '7d': 'Last 7 Days',
  '30d': 'Last 30 Days',
  '90d': 'Last 90 Days',
}

const stageColumns: DataTableColumn[] = [
  { key: 'stage', label: 'Stage', sortable: false },
  { key: 'value', label: 'Value', sortable: false, align: 'right' },
  { key: 'status', label: 'Status', sortable: false },
  { key: 'note', label: 'Source', sortable: false },
]

export default async function FunnelPage({
  searchParams,
}: {
  searchParams: { range?: string }
}) {
  const data = await getJourneyData(searchParams)
  const rangeLabel = RANGE_LABELS[searchParams?.range ?? '30d'] ?? 'Last 30 Days'

  const maxValue = data.stages.reduce((m, s) => Math.max(m, s.value), 0) || 1
  const funnelSteps: FunnelChartStep[] = data.stages.map((s) => ({
    name: s.name,
    value: s.value,
    percentage: (s.value / maxValue) * 100,
    dropOff: 0,
    note: s.sourced ? s.note : 'Not connected',
  }))

  const stageRows = data.stages.map((s) => ({
    stage: s.name,
    value: s.sourced ? formatNumber(s.value) : '—',
    status: s.sourced ? 'Live' : 'Not connected',
    note: s.note,
  }))

  const attributionBar: BarChartDataPoint[] = data.attribution.map((a) => ({ label: a.platform, value: a.clicks }))

  return (
    <div>
      <Header title="User Journey" />

      {/* How to read this */}
      <div className="mb-6 rounded-lg border border-mrhb-blue-light bg-mrhb-blue-light/30 p-4">
        <p className="text-sm font-medium text-mrhb-dark">How to read this funnel</p>
        <p className="mt-1 text-xs text-mrhb-dark/70">
          Impressions → Clicks → App Installs → 1st Dashboard → 1st Transaction → Revenue for {rangeLabel.toLowerCase()}.
          Bar width is proportional to each stage&apos;s value. These stages come from <strong>different sources and
          populations</strong> — it&apos;s a cross-source journey, <strong>not a single tracked cohort</strong>: the
          app stages count the whole active user base, so they can exceed installs. &ldquo;1st Dashboard/Transaction&rdquo;
          are approximated as users-who-reached until dedicated first-time events exist. Stages marked{' '}
          <strong>Not connected</strong> (app-store &amp; social impressions, revenue) are awaiting a data source and
          are never estimated. App-event stages are driven by{' '}
          {data.configured ? 'your Admin event config' : 'built-in defaults (configure in Admin)'}.
        </p>
      </div>

      {/* The funnel */}
      <div className="mb-6">
        <FunnelChart steps={funnelSteps} title={`Acquisition → Revenue (${rangeLabel})`} showDropOff={false} />
      </div>

      {/* Stage detail table */}
      <div className="mb-8">
        <DataTable columns={stageColumns} data={stageRows} title="Stage Detail" emptyMessage="No journey data for this period." />
      </div>

      {/* Attribution */}
      <h2 className="mb-1 text-lg font-semibold text-mrhb-dark">
        Social Attribution <span className="text-xs font-normal text-mrhb-dark/40">&middot; {rangeLabel}</span>
      </h2>
      <p className="mb-4 text-sm text-mrhb-dark/60">
        Short.io link clicks by platform (reliable). GA4 social sessions are shown only as an aggregate — Google
        reports these under a generic &ldquo;social&rdquo; source, so a trustworthy per-platform GA4 breakdown
        isn&apos;t available.
      </p>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <BarChart
            data={attributionBar}
            title="Short.io Clicks by Platform"
            color="#01A6FA"
            valueLabel="Total Clicks"
            height={320}
            layout="horizontal"
          />
        </div>
        <div>
          <KPICard
            title="GA4 Social Sessions (aggregate)"
            value={formatNumber(data.ga4SocialSessions)}
            iconName="share2"
            tooltip="All GA4 website sessions in the 'Organic Social' channel for this range. Not split per platform (GA4 source is the generic 'social')."
          />
        </div>
      </div>
    </div>
  )
}
