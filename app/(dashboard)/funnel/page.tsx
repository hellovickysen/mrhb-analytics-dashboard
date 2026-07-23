import Header from '@/components/layout/Header'
import FunnelChart, { type FunnelChartStep } from '@/components/charts/FunnelChart'
import BarChart, { type BarChartDataPoint } from '@/components/charts/BarChart'
import DataTable, { type DataTableColumn } from '@/components/tables/DataTable'
import { formatNumber, formatPercent } from '@/lib/utils/format'
import { createServiceClient } from '@/lib/supabase/server'

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------
// This is a Server Component. The funnel is stitched together live from five
// independent source tables (there is no single pre-built "funnel" rollup
// table yet) — Short.io clicks -> GA4 sessions -> GA4 blog/product pageviews
// -> Play Console store impressions -> Play Console installs -> GA4
// wallet/transaction events. Each stage query is independent, so a gap in
// one source (e.g. Play Console not synced yet) doesn't take down the whole
// page — we simply fall back to mock data for the entire funnel whenever any
// stage can't be computed from real rows, to keep the funnel internally
// consistent (a partially-mock, partially-real funnel would be misleading).

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

const MOCK_FUNNEL_DATA: FunnelData = {
  stages: [
    { name: 'Social Discovery', users: 14320 },
    { name: 'Website Visit', users: 9142 },
    { name: 'Blog/Product Engagement', users: 5840 },
    { name: 'Play Store View', users: 3210 },
    { name: 'App Install', users: 1860 },
    { name: 'Wallet Created', users: 1120 },
    { name: 'First Transaction', users: 486 },
    { name: 'Retained (30-day)', users: 312 },
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

function daysAgoISO(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

async function getFunnelData(): Promise<FunnelData> {
  const supabase = createServiceClient()
  const since = daysAgoISO(30)

  // Stage 1: Social Discovery — human clicks on shortened social links.
  const stage1 = await supabase
    .from('shortio_clicks')
    .select('human_clicks')
    .gte('date', since)

  // Stage 2: Website Visit — GA4 sessions arriving via social/referral.
  const stage2 = await supabase
    .from('ga_traffic')
    .select('sessions, channel')
    .gte('date', since)
    .in('channel', ['social', 'referral'])

  // Stage 3: Blog/Product Engagement — pageviews on blog or Sahal pages.
  const stage3 = await supabase
    .from('ga_pages')
    .select('pageviews, page_path')
    .gte('date', since)

  // Stage 4: Play Store View — store listing impressions.
  const stage4 = await supabase
    .from('play_store_listing')
    .select('impressions')
    .gte('date', since)

  // Stage 5: App Install — Play Console installs.
  const stage5 = await supabase
    .from('play_installs')
    .select('installs')
    .gte('date', since)

  // Stages 6-8: Wallet Created / First Transaction / Retained — GA4 events.
  const stage678 = await supabase
    .from('ga_events')
    .select('event_name, event_count')
    .gte('date', since)
    .in('event_name', ['wallet_created', 'first_transaction', 'retained_30_day'])

  const anyError =
    stage1.error || stage2.error || stage3.error || stage4.error || stage5.error || stage678.error

  const socialDiscovery = (stage1.data ?? []).reduce((sum, r) => sum + (r.human_clicks ?? 0), 0)
  const websiteVisit = (stage2.data ?? []).reduce((sum, r) => sum + (r.sessions ?? 0), 0)
  const blogEngagement = (stage3.data ?? [])
    .filter((r) => r.page_path?.startsWith('/blogs/') || r.page_path?.startsWith('/sahal'))
    .reduce((sum, r) => sum + (r.pageviews ?? 0), 0)
  const playStoreView = (stage4.data ?? []).reduce((sum, r) => sum + (r.impressions ?? 0), 0)
  const appInstall = (stage5.data ?? []).reduce((sum, r) => sum + (r.installs ?? 0), 0)

  const eventCounts = (stage678.data ?? []).reduce<Record<string, number>>((acc, r) => {
    acc[r.event_name] = (acc[r.event_name] ?? 0) + (r.event_count ?? 0)
    return acc
  }, {})
  const walletCreated = eventCounts['wallet_created'] ?? 0
  const firstTransaction = eventCounts['first_transaction'] ?? 0
  const retained = eventCounts['retained_30_day'] ?? 0

  const stages: FunnelStageRow[] = [
    { name: 'Social Discovery', users: socialDiscovery },
    { name: 'Website Visit', users: websiteVisit },
    { name: 'Blog/Product Engagement', users: blogEngagement },
    { name: 'Play Store View', users: playStoreView },
    { name: 'App Install', users: appInstall },
    { name: 'Wallet Created', users: walletCreated },
    { name: 'First Transaction', users: firstTransaction },
    { name: 'Retained (30-day)', users: retained },
  ]

  // A usable funnel needs every stage to have a non-zero count — if any
  // upstream source hasn't synced yet, the shape would be misleading (e.g.
  // a funnel that inexplicably jumps to 0 at "Play Store View" just because
  // Play Console isn't wired up). Fall back to mock for the whole funnel.
  const hasCompleteFunnel = !anyError && stages.every((s) => s.users > 0)

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
    stages: hasCompleteFunnel ? stages : MOCK_FUNNEL_DATA.stages,
    attribution: hasAttribution ? attribution : MOCK_FUNNEL_DATA.attribution,
  }
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
  'Website Visit->Blog/Product Engagement':
    'Visitors land but don’t explore — consider clearer above-the-fold value props and internal links from the homepage into product/blog content.',
  'Blog/Product Engagement->Play Store View':
    'Engaged readers aren’t clicking through to the app listing — add more prominent, repeated app-download CTAs inside blog and product pages.',
  'Play Store View->App Install':
    'Store listing visitors are hesitating at the install decision — review screenshots, reviews, and permissions copy for install-intent friction.',
  'App Install->Wallet Created':
    'Installs aren’t completing onboarding — audit the wallet-creation flow (KYC steps, form length) for drop-off points.',
  'Wallet Created->First Transaction':
    'Wallets sit idle post-creation — a first-transaction incentive or guided “make your first transfer” nudge could close this gap.',
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

export default async function FunnelPage() {
  const data = await getFunnelData()
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
