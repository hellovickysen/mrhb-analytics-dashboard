import Header from '@/components/layout/Header'
import BarChart, { type BarChartDataPoint } from '@/components/charts/BarChart'
import DataTable, { type DataTableColumn } from '@/components/tables/DataTable'
import KPICard from '@/components/cards/KPICard'
import { formatNumber } from '@/lib/utils/format'
import { createServiceClient } from '@/lib/supabase/server'
import { getDateWindow } from '@/lib/utils/date-range'
import {
  Eye,
  MousePointerClick,
  Download,
  LayoutDashboard,
  ArrowLeftRight,
  DollarSign,
  ChevronDown,
  Info,
  type LucideIcon,
} from 'lucide-react'

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
// cross-source journey, NOT a single tracked cohort (dashboard/transaction
// count the whole active base, so they can exceed installs). "1st Dashboard/
// Transaction" are approximated as users-who-reached until dedicated first-time
// events exist. Sources not yet connected (app-store & social impressions,
// revenue) render as "Not connected" — never faked. The magnitude fill bar
// under each stage is proportional to its value, so it never misrepresents.
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

    let webImpressions = 0
    let webClicks = 0
    for (const r of gscRows) {
      webImpressions += Number(r.impressions) || 0
      webClicks += Number(r.clicks) || 0
    }

    const rangeRow = shortioRes.data?.[0] as { total_clicks: number; human_clicks: number } | undefined
    const socialHuman = Number(rangeRow?.human_clicks) || 0

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
        note: configured ? 'First opens · admin-configured events' : 'First opens (first_open) · default',
        sourced: appUsers['App Installs'] > 0,
      },
      {
        name: '1st Dashboard',
        value: appUsers['1st Dashboard'],
        note: 'Users who reached dashboard (approx.)',
        sourced: appUsers['1st Dashboard'] > 0,
      },
      {
        name: '1st Transaction',
        value: appUsers['1st Transaction'],
        note: 'Users who transacted — send / swap / ramp (approx.)',
        sourced: appUsers['1st Transaction'] > 0,
      },
      {
        name: 'Revenue',
        value: revenueValue,
        note: revenueConfigured ? 'In-app revenue' : 'Needs Firebase revenue events',
        sourced: revenueConfigured,
      },
    ]

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

// Visual identity per stage (icon + accent color). Connected stages use their
// accent; not-connected stages are rendered muted regardless.
const STAGE_META: Record<string, { icon: LucideIcon; from: string; to: string }> = {
  Impressions: { icon: Eye, from: '#01A6FA', to: '#38BDF8' },
  Clicks: { icon: MousePointerClick, from: '#0E8BE6', to: '#22A6F0' },
  'App Installs': { icon: Download, from: '#5566E0', to: '#7C8CF0' },
  '1st Dashboard': { icon: LayoutDashboard, from: '#8B5CD6', to: '#A87BEA' },
  '1st Transaction': { icon: ArrowLeftRight, from: '#E08A2B', to: '#F0A94E' },
  Revenue: { icon: DollarSign, from: '#12B76A', to: '#3AD98C' },
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
  const topValue = data.stages[0]?.value ?? 0

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

      {/* Funnel card */}
      <div className="mb-6 overflow-hidden rounded-2xl bg-mrhb-white shadow-sm ring-1 ring-mrhb-warm-grey/10">
        <div className="flex flex-col gap-1 border-b border-mrhb-warm-grey/10 bg-gradient-to-r from-mrhb-blue/5 to-transparent px-6 py-5">
          <h2 className="text-lg font-semibold text-mrhb-dark">Acquisition → Revenue</h2>
          <p className="text-xs text-mrhb-dark/50">{rangeLabel} · width shows relative volume</p>
        </div>

        <div className="px-4 py-6 sm:px-6">
          {data.stages.length === 0 ? (
            <p className="py-10 text-center text-sm text-mrhb-dark/50">No journey data for this period.</p>
          ) : (
            <div className="mx-auto flex max-w-3xl flex-col">
              {data.stages.map((stage, index) => {
                const meta = STAGE_META[stage.name] ?? { icon: Eye, from: '#01A6FA', to: '#38BDF8' }
                const Icon = meta.icon
                const fillPct = stage.sourced ? Math.max(4, Math.round((stage.value / maxValue) * 100)) : 0
                const shareOfTop = stage.sourced && topValue > 0 ? (stage.value / topValue) * 100 : null
                const isLast = index === data.stages.length - 1

                return (
                  <div key={stage.name}>
                    <div
                      className={`group relative rounded-xl border p-4 transition-all duration-200 hover:shadow-md ${
                        stage.sourced
                          ? 'border-mrhb-warm-grey/15 bg-mrhb-white'
                          : 'border-dashed border-mrhb-warm-grey/40 bg-mrhb-cream/40'
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        {/* Icon tile */}
                        <div
                          className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl text-white shadow-sm"
                          style={
                            stage.sourced
                              ? { backgroundImage: `linear-gradient(135deg, ${meta.from}, ${meta.to})` }
                              : { backgroundColor: '#C9C0B4' }
                          }
                        >
                          <Icon size={22} />
                        </div>

                        {/* Name + note */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-bold text-mrhb-dark/30">{index + 1}</span>
                            <h3 className="truncate text-sm font-semibold text-mrhb-dark sm:text-base">{stage.name}</h3>
                          </div>
                          <p className="mt-0.5 text-xs leading-snug text-mrhb-dark/50">{stage.note}</p>
                        </div>

                        {/* Value + status */}
                        <div className="flex-shrink-0 text-right">
                          {stage.sourced ? (
                            <>
                              <p className="text-2xl font-bold leading-none text-mrhb-dark">
                                {formatNumber(stage.value)}
                              </p>
                              {shareOfTop !== null && (
                                <p className="mt-1 text-[11px] font-medium text-mrhb-dark/40">
                                  {shareOfTop.toFixed(shareOfTop >= 10 ? 0 : 1)}% of top
                                </p>
                              )}
                            </>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-mrhb-warm-grey/20 px-2.5 py-1 text-[11px] font-semibold text-mrhb-dark/50">
                              Not connected
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Magnitude fill bar */}
                      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-mrhb-warm-grey/15">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${fillPct}%`,
                            backgroundImage: stage.sourced
                              ? `linear-gradient(90deg, ${meta.from}, ${meta.to})`
                              : 'none',
                          }}
                        />
                      </div>
                    </div>

                    {/* Connector */}
                    {!isLast && (
                      <div className="flex justify-center py-1.5">
                        <ChevronDown size={18} className="text-mrhb-warm-grey/50" />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* How to read this */}
      <div className="mb-8 flex items-start gap-2.5 rounded-xl border border-mrhb-blue-light bg-mrhb-blue-light/20 p-4">
        <Info size={16} className="mt-0.5 flex-shrink-0 text-mrhb-blue" />
        <p className="text-xs leading-relaxed text-mrhb-dark/70">
          This is a <strong>cross-source journey, not a single tracked cohort</strong>: stages come from different
          sources and user populations, so app stages (which count the whole active base) can exceed installs.
          &ldquo;1st Dashboard/Transaction&rdquo; are approximated as users-who-reached until dedicated first-time
          events exist. Stages marked <strong>Not connected</strong> — app-store &amp; social impressions and revenue —
          are awaiting a data source and are never estimated. App stages are driven by{' '}
          {data.configured ? 'your Admin event configuration' : 'built-in defaults (configure them in Admin)'}.
        </p>
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
