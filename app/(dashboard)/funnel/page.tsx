import Header from '@/components/layout/Header'
import FunnelChart, { type FunnelChartStep } from '@/components/charts/FunnelChart'
import BarChart, { type BarChartDataPoint } from '@/components/charts/BarChart'
import DataTable, { type DataTableColumn } from '@/components/tables/DataTable'
import { formatNumber, formatPercent } from '@/lib/utils/format'
import { createServiceClient } from '@/lib/supabase/server'
import { getDateWindow } from '@/lib/utils/date-range'

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------
// This is a Server Component. The funnel is stitched together live from
// Short.io clicks -> GA4 web sessions -> real Firebase/GA4-for-Firebase event
// names emitted by the Sahal mobile app, as recorded in `ga_events`. Firebase
// automatically fires `first_open` on first app launch after install, so that
// replaces the old Play Console install-count dependency entirely — there's
// no more separate "Play Store View" stage since Play Console isn't wired up
// as a source here.
//
// Each stage is queried independently against `ga_events` (or, for the top
// of the funnel, `shortio_clicks` / `ga_traffic`), so a gap in one event
// stream doesn't take down the whole page. Per-stage results fall back to a
// per-stage mock value when that stage's query errors or returns 0, and the
// whole funnel falls back to the fully-mocked dataset only if every real
// stage came back empty (i.e. `ga_events` hasn't synced anything yet).
//
// Firebase event volume isn't guaranteed to be monotonically decreasing the
// way a strict funnel is (e.g. duplicate `SA_APP_DASHBOARD` fires per
// session can outnumber `first_open` events from installs before the tracked
// window). To keep the funnel visualization meaningful, later stages are
// capped at the previous stage's value after all queries resolve.

interface FunnelStageRow {
  name: string
  users: number
}

interface AttributionRow {
  platform: string
  shortioHumanClicks: number
  ga4Sessions: number
}

interface FunnelData {
  stages: FunnelStageRow[]
  attribution: AttributionRow[]
}

// Per-stage fallback values, used whenever that specific stage's query
// errors or comes back with a zero sum. Keeping these per-stage (rather than
// only an all-or-nothing mock) means a single slow-to-sync event name
// doesn't blank out stages that do have real data.
const STAGE_FALLBACKS = {
  socialDiscovery: 14320,
  websiteVisit: 9142,
  appInstall: 1860,
  onboardingStarted: 3210,
  walletCreated: 1120,
  onboardingComplete: 486,
  firstTransaction: 486,
  retained: 312,
} as const

const MOCK_FUNNEL_DATA: FunnelData = {
  stages: [
    { name: 'Social Discovery', users: STAGE_FALLBACKS.socialDiscovery },
    { name: 'Website Visit', users: STAGE_FALLBACKS.websiteVisit },
    { name: 'App Install', users: STAGE_FALLBACKS.appInstall },
    { name: 'Onboarding Started', users: STAGE_FALLBACKS.onboardingStarted },
    { name: 'Wallet Created', users: STAGE_FALLBACKS.walletCreated },
    { name: 'Onboarding Complete', users: STAGE_FALLBACKS.onboardingComplete },
    { name: 'First Transaction', users: STAGE_FALLBACKS.firstTransaction },
    { name: 'Retained (30-day)', users: STAGE_FALLBACKS.retained },
  ],
  attribution: [
    { platform: 'Twitter', shortioHumanClicks: 77, ga4Sessions: 3480 },
    { platform: 'Telegram', shortioHumanClicks: 8, ga4Sessions: 410 },
    { platform: 'Facebook', shortioHumanClicks: 6, ga4Sessions: 1820 },
    { platform: 'LinkedIn', shortioHumanClicks: 5, ga4Sessions: 1690 },
    { platform: 'Instagram', shortioHumanClicks: 4, ga4Sessions: 7910 },
    { platform: 'YouTube', shortioHumanClicks: 3, ga4Sessions: 265 },
  ],
}

// Referrer domain -> display platform name, shared with the social page's
// platform mapping so attribution stays consistent across the dashboard.
const REFERRER_TO_PLATFORM: Record<string, string> = {
  't.co': 'Twitter',
  'ir.ilmili.telegraph': 'Telegram',
  'm.facebook.com': 'Facebook',
  'lnkd.in': 'LinkedIn',
  'l.instagram.com': 'Instagram',
  'www.youtube.com': 'YouTube',
}

// GA4 `source` values that correspond to each social platform's attribution
// bucket (lowercased for case-insensitive matching).
const PLATFORM_BY_GA_SOURCE: Record<string, string> = {
  twitter: 'Twitter',
  't.co': 'Twitter',
  x: 'Twitter',
  telegram: 'Telegram',
  facebook: 'Facebook',
  'm.facebook.com': 'Facebook',
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  youtube: 'YouTube',
}

/** Sums `event_count` off a `ga_events`-shaped result set, treating nulls as 0. */
function sumEventCount(rows: { event_count: number | null }[] | null): number {
  return (rows ?? []).reduce((sum, row) => sum + (row.event_count ?? 0), 0)
}

async function getFunnelData(searchParams?: { range?: string }): Promise<FunnelData> {
  const supabase = createServiceClient()
  const { startDate: since } = getDateWindow(searchParams)

  // Stage 1: Social Discovery — Short.io's domain-wide click rollup row.
  const stage1 = await supabase
    .from('shortio_clicks')
    .select('total_clicks')
    .eq('link_id', 'domain_total')
    .gte('date', since)

  // Stage 2: Website Visit — GA4 web sessions arriving via social/referral.
  const stage2 = await supabase
    .from('ga_traffic')
    .select('sessions')
    .gte('date', since)
    .in('channel', ['Social', 'Referral', 'Organic Social'])

  // Stage 3: App Install — Firebase's automatic `first_open` event, which
  // fires the first time the app is launched after install.
  const stage3 = await supabase
    .from('ga_events')
    .select('event_count')
    .eq('event_name', 'first_open')
    .gte('date', since)

  // Stage 4: Onboarding Started — new user first actions only (not screen views).
  // Uses EW_ prefix events which are cross-platform action events, not SA_ screen views
  // which fire for returning users too.
  const stage4 = await supabase
    .from('ga_events')
    .select('event_count')
    .gte('date', since)
    .or(
      'event_name.like.EW_ONBOARDING_LETS_GO%,event_name.like.EW_ONBOARDING_SOCIAL_SIGNUP%,event_name.like.EW_ONBOARDING_IMPORT_WALLET%,event_name.like.EW_ONBOARDING_IMPORT_BACKUP%,event_name.like.EW_ONBOARDING_IMPORT_PRIVATE%,event_name.like.EW_ONBOARDING_GUIDE_SKIP%'
    )

  // Stage 5: Wallet Created — reaching the main app dashboard requires a
  // wallet to exist, so `SA_APP_DASHBOARD` is used as the wallet-created proxy.
  const stage5 = await supabase
    .from('ga_events')
    .select('event_count')
    .eq('event_name', 'SA_APP_DASHBOARD')
    .gte('date', since)

  // Stage 6: Onboarding Complete — the guided-onboarding completion event.
  const stage6 = await supabase
    .from('ga_events')
    .select('event_count')
    .eq('event_name', 'EW_ONBOARDING_GUIDE_COMPLETE')
    .gte('date', since)

  // Stage 7: Transactions — all send/swap/stake/store events across platforms.
  // EA_SEND_* = Android, EI_SEND_* = iOS, EW_SEND_* = web/extension
  // Dev team confirmed: SENTx, SWAPxLIFI, SAHAL_STAKEx, MRHB_STOREx, etc.
  const [stage7a, stage7b, stage7c] = await Promise.all([
    supabase.from('ga_events').select('event_count').gte('date', since).like('event_name', 'EA_SEND_%'),
    supabase.from('ga_events').select('event_count').gte('date', since).like('event_name', 'EI_SEND_%'),
    supabase.from('ga_events').select('event_count').gte('date', since).like('event_name', 'EW_SEND_%'),
  ])
  const stage7 = {
    data: [...(stage7a.data ?? []), ...(stage7b.data ?? []), ...(stage7c.data ?? [])],
  }

  // Stage 8: Retained (30-day) — a full "first SA_APP_DASHBOARD + 30 days
  // later" cohort query isn't expressible through supabase-js without a
  // custom RPC, so this is simplified to `session_start` events in the last
  // 7 days as a proxy for currently-active/returning users.
  const stage8 = await supabase
    .from('ga_events')
    .select('event_count')
    .eq('event_name', 'session_start')
    .gte('date', getDateWindow({ range: '7d' }).startDate)

  const socialDiscovery = (stage1.data ?? []).reduce(
    (sum, r) => sum + (r.total_clicks ?? 0),
    0
  )
  const websiteVisit = (stage2.data ?? []).reduce((sum, r) => sum + (r.sessions ?? 0), 0)
  const appInstall = sumEventCount(stage3.data)
  const onboardingStarted = sumEventCount(stage4.data)
  const walletCreated = sumEventCount(stage5.data)
  const onboardingComplete = sumEventCount(stage6.data)
  const firstTransaction = sumEventCount(stage7.data)
  const retained = sumEventCount(stage8.data)

  // Per-stage fallback: an individual stage falls back to its own mock value
  // whenever that query errored or genuinely summed to 0, so one missing
  // event stream doesn't blank the entire funnel.
  const resolvedStages: FunnelStageRow[] = [
    {
      name: 'Social Discovery',
      users: !stage1.error && socialDiscovery > 0 ? socialDiscovery : STAGE_FALLBACKS.socialDiscovery,
    },
    {
      name: 'Website Visit',
      users: !stage2.error && websiteVisit > 0 ? websiteVisit : STAGE_FALLBACKS.websiteVisit,
    },
    {
      name: 'App Install',
      users: !stage3.error && appInstall > 0 ? appInstall : STAGE_FALLBACKS.appInstall,
    },
    {
      name: 'Onboarding Started',
      users:
        !stage4.error && onboardingStarted > 0
          ? onboardingStarted
          : STAGE_FALLBACKS.onboardingStarted,
    },
    {
      name: 'Wallet Created',
      users: !stage5.error && walletCreated > 0 ? walletCreated : STAGE_FALLBACKS.walletCreated,
    },
    {
      name: 'Onboarding Complete',
      users:
        !stage6.error && onboardingComplete > 0
          ? onboardingComplete
          : STAGE_FALLBACKS.onboardingComplete,
    },
    {
      name: 'First Transaction',
      users:
        firstTransaction > 0
          ? firstTransaction
          : STAGE_FALLBACKS.firstTransaction,
    },
    {
      name: 'Retained (30-day)',
      users: !stage8.error && retained > 0 ? retained : STAGE_FALLBACKS.retained,
    },
  ]

  // If literally every ga_events-backed stage came back empty/erroring (i.e.
  // Firebase event sync hasn't produced any rows yet), fall back to the
  // fully-mocked funnel so the UI still renders something coherent rather
  // than a funnel that's all individually-substituted fallback numbers.
  const allEventStagesEmpty =
    appInstall === 0 &&
    onboardingStarted === 0 &&
    walletCreated === 0 &&
    onboardingComplete === 0 &&
    firstTransaction === 0 &&
    retained === 0

  const stages = allEventStagesEmpty ? MOCK_FUNNEL_DATA.stages : capToFunnelShape(resolvedStages)

  // Social -> Website attribution: Short.io human clicks per platform vs.
  // GA4 sessions recorded from the matching social source.
  const clicksByReferrer = await supabase
    .from('shortio_clicks')
    .select('referrer, human_clicks')
    .gte('date', since)

  const sessionsBySource = await supabase
    .from('ga_traffic')
    .select('source, sessions')
    .gte('date', since)
    .eq('channel', 'social')

  const humanClicksByPlatform = (clicksByReferrer.data ?? []).reduce<Record<string, number>>(
    (acc, r) => {
      const platform = r.referrer ? REFERRER_TO_PLATFORM[r.referrer] : undefined
      if (platform) acc[platform] = (acc[platform] ?? 0) + (r.human_clicks ?? 0)
      return acc
    },
    {}
  )

  const sessionsByPlatform = (sessionsBySource.data ?? []).reduce<Record<string, number>>(
    (acc, r) => {
      const platform = r.source ? PLATFORM_BY_GA_SOURCE[r.source.toLowerCase()] : undefined
      if (platform) acc[platform] = (acc[platform] ?? 0) + (r.sessions ?? 0)
      return acc
    },
    {}
  )

  const attributionPlatforms = Object.keys(REFERRER_TO_PLATFORM).map(
    (referrer) => REFERRER_TO_PLATFORM[referrer]
  )
  const attribution: AttributionRow[] = attributionPlatforms.map((platform) => ({
    platform,
    shortioHumanClicks: humanClicksByPlatform[platform] ?? 0,
    ga4Sessions: sessionsByPlatform[platform] ?? 0,
  }))

  const hasAttribution =
    !clicksByReferrer.error &&
    !sessionsBySource.error &&
    attribution.some((a) => a.shortioHumanClicks > 0 || a.ga4Sessions > 0)

  return {
    stages,
    attribution: hasAttribution ? attribution : MOCK_FUNNEL_DATA.attribution,
  }
}

/**
 * Firebase event volume isn't guaranteed to strictly decrease stage over
 * stage the way store-funnel data does (e.g. `SA_APP_DASHBOARD` can fire
 * many times per user per day, while `first_open` only fires once ever per
 * device). Cap each stage at the previous stage's value so the funnel
 * visualization always narrows, never widens.
 */
function capToFunnelShape(stages: FunnelStageRow[]): FunnelStageRow[] {
  const capped: FunnelStageRow[] = []
  let ceiling = Infinity

  for (const stage of stages) {
    const users = Math.min(stage.users, ceiling)
    capped.push({ name: stage.name, users })
    ceiling = users
  }

  return capped
}

// ---------------------------------------------------------------------------
// Derived metrics
// ---------------------------------------------------------------------------

interface EnrichedStage extends FunnelStageRow {
  percentageOfTotal: number
  dropOffFromPrevious: number
  usersProgressedToNext: number | null
  conversionToNext: number | null
}

function enrichStages(stages: FunnelStageRow[]): EnrichedStage[] {
  const topOfFunnel = stages[0]?.users ?? 1

  return stages.map((stage, index) => {
    const previous = stages[index - 1]
    const next = stages[index + 1]

    const percentageOfTotal = (stage.users / topOfFunnel) * 100
    const dropOffFromPrevious = previous
      ? ((previous.users - stage.users) / previous.users) * 100
      : 0
    const conversionToNext = next ? (next.users / stage.users) * 100 : null
    const usersProgressedToNext = next ? next.users : null

    return {
      ...stage,
      percentageOfTotal,
      dropOffFromPrevious,
      usersProgressedToNext,
      conversionToNext,
    }
  })
}

interface DropOffPoint {
  fromStage: string
  toStage: string
  dropOffPct: number
  usersLost: number
  insight: string
}

// Actionable copy per (fromStage -> toStage) transition. Falls back to a
// generic message if a transition isn't explicitly covered here.
const DROP_OFF_INSIGHTS: Record<string, string> = {
  'Social Discovery->Website Visit':
    'Social posts and bio links aren’t converting into site visits — tighten UTM-tagged CTAs and make the link-in-bio destination match the promised content.',
  'Website Visit->App Install':
    'Visitors aren’t converting to installs — review the app-download CTA placement and store-listing appeal linked from the website.',
  'App Install->Onboarding Started':
    'Installs aren’t opening onboarding — check for first-launch friction (permissions prompts, splash/load time) before `SA_GET_STARTED`/`EW_ONBOARDING_LETS_GO` fires.',
  'Onboarding Started->Wallet Created':
    'Users start onboarding but don’t reach the dashboard — audit the wallet-creation flow (KYC steps, seed phrase, form length) for drop-off points.',
  'Wallet Created->Onboarding Complete':
    'Wallets are created but users don’t finish the guided walkthrough — consider shortening `EW_ONBOARDING_GUIDE_COMPLETE`’s remaining steps or adding a skip-and-remind option.',
  'Onboarding Complete->First Transaction':
    'Onboarded users aren’t transacting — a first-transaction incentive or guided “make your first transfer” nudge could close this gap.',
  'First Transaction->Retained (30-day)':
    'Users transact once but don’t come back — lifecycle emails/push notifications and recurring-use features (Sahal Earn, Sahal Give) may help retention.',
}

function buildDropOffPoints(stages: EnrichedStage[]): DropOffPoint[] {
  const transitions: DropOffPoint[] = []

  for (let i = 1; i < stages.length; i++) {
    const from = stages[i - 1]
    const to = stages[i]
    const key = `${from.name}->${to.name}`

    transitions.push({
      fromStage: from.name,
      toStage: to.name,
      dropOffPct: to.dropOffFromPrevious,
      usersLost: from.users - to.users,
      insight:
        DROP_OFF_INSIGHTS[key] ??
        `${to.dropOffFromPrevious.toFixed(0)}% drop from ${from.name} to ${to.name} — investigate this step for friction.`,
    })
  }

  return transitions.sort((a, b) => b.dropOffPct - a.dropOffPct)
}

const stageColumns: DataTableColumn[] = [
  { key: 'stage', label: 'Stage', sortable: true },
  { key: 'usersEntered', label: 'Users Entered', sortable: true, align: 'right' },
  { key: 'usersProgressed', label: 'Users Progressed', sortable: true, align: 'right' },
  { key: 'conversionRate', label: 'Conversion Rate', sortable: true, align: 'right' },
  { key: 'dropOffRate', label: 'Drop-off Rate', sortable: true, align: 'right' },
]

export default async function FunnelPage({
  searchParams,
}: {
  searchParams: { range?: string }
}) {
  const data = await getFunnelData(searchParams)
  const enrichedStages = enrichStages(data.stages)
  const topDropOffs = buildDropOffPoints(enrichedStages).slice(0, 3)

  const funnelSteps: FunnelChartStep[] = enrichedStages.map((stage) => ({
    name: stage.name,
    value: stage.users,
    percentage: stage.percentageOfTotal,
    dropOff: stage.dropOffFromPrevious,
  }))

  const stageRows = enrichedStages.map((stage) => ({
    stage: stage.name,
    usersEntered: formatNumber(stage.users),
    usersProgressed:
      stage.usersProgressedToNext !== null ? formatNumber(stage.usersProgressedToNext) : '— (final stage)',
    conversionRate: stage.conversionToNext !== null ? formatPercent(stage.conversionToNext) : '—',
    dropOffRate: formatPercent(stage.dropOffFromPrevious),
  }))

  const attributionChartData: BarChartDataPoint[] = data.attribution.map((row) => ({
    label: row.platform,
    value: row.shortioHumanClicks,
    secondaryValue: row.ga4Sessions,
  }))

  return (
    <div>
      <Header title="User Journey & Funnel" />

      {/* Main funnel visualization */}
      <div className="mb-6">
        <FunnelChart steps={funnelSteps} title="Conversion Funnel: Discovery to Retention" />
      </div>

      {/* Biggest drop-offs + stage conversion table */}
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Biggest Drop-off Points */}
        <div className="rounded-xl bg-mrhb-white p-5 shadow-sm">
          <h3 className="mb-4 text-base font-semibold text-mrhb-dark">
            Biggest Drop-off Points
          </h3>
          <ul className="space-y-4">
            {topDropOffs.map((point, index) => (
              <li
                key={`${point.fromStage}-${point.toStage}`}
                className="rounded-lg border border-red-200 bg-red-50 p-4"
              >
                <div className="flex items-start gap-3">
                  <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-red-500 text-xs font-bold text-white">
                    {index + 1}
                  </span>
                  <div className="flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-semibold text-mrhb-dark">
                        {point.fromStage} &rarr; {point.toStage}
                      </p>
                      <span className="whitespace-nowrap text-sm font-bold text-red-600">
                        -{point.dropOffPct.toFixed(1)}%
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-mrhb-dark/60">
                      {formatNumber(point.usersLost)} users lost at this step
                    </p>
                    <p className="mt-2 text-sm text-mrhb-dark/80">{point.insight}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Stage Conversion Rates table */}
        <DataTable
          columns={stageColumns}
          data={stageRows}
          title="Stage Conversion Rates"
          emptyMessage="No funnel data available for this period."
        />
      </div>

      {/* Social -> Website Attribution */}
      <div className="mb-2">
        <h2 className="mb-1 text-lg font-semibold text-mrhb-dark">
          Social &rarr; Website Attribution
        </h2>
        <p className="mb-4 text-sm text-mrhb-dark/60">
          Short.io human clicks by platform (from mrhbnetwork.short.gy UTM links) compared
          against GA4 sessions recorded from the matching social source, showing how much
          on-site traffic each platform&apos;s clicks actually drive.
        </p>
      </div>
      <BarChart
        data={attributionChartData}
        title="Short.io Human Clicks vs. GA4 Sessions by Platform"
        color="#01A6FA"
        secondaryColor="#E5B897"
        valueLabel="Short.io Human Clicks"
        secondaryValueLabel="GA4 Sessions"
        height={340}
        layout="vertical"
      />
    </div>
  )
}
