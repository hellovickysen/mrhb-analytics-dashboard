import Header from '@/components/layout/Header'
import KPICard from '@/components/cards/KPICard'
import AreaChart, { type AreaChartDataPoint } from '@/components/charts/AreaChart'
import BarChart, { type BarChartDataPoint } from '@/components/charts/BarChart'
import DataTable, { type DataTableColumn } from '@/components/tables/DataTable'
import { formatNumber, formatPercent, deltaFromPct } from '@/lib/utils/format'
import { createServiceClient } from '@/lib/supabase/server'
import { getDateWindow } from '@/lib/utils/date-range'
import { fetchGA4AppActiveUsersTotal } from '@/lib/api-clients/ga4-app-active-total'
import { fetchGA4AppOnboardingFunnel, fetchGA4AppRateInputs, fetchGA4AppTransactionsByType, APP_TRANSACTION_TYPES } from '@/lib/api-clients/ga4-app-funnel'
import { fetchRecentPlayReviews, type PlayReviewItem } from '@/lib/api-clients/play-reviews'
import { computeToolTabs, toolForEventName, DEFAULT_TOOL_MAPPINGS, type ToolMapping, type ToolTab } from '@/lib/config/tool-usage'
import ToolUsageTabs from '@/components/app-performance/ToolUsageTabs'
import { resolveAppMetrics, matchesAppMetric } from '@/lib/config/app-metrics'

// ---------------------------------------------------------------------------
// App Performance (Sahal Wallet) — reworked for correctness.
//
// PRIMARY SOURCE: the Firebase-linked GA4 app property via `ga_events`
// (paginated — the 30/90-day windows exceed Supabase's 1,000-row cap).
// Event names are matched ACROSS PLATFORMS (SA_/SI_/SW_ screens and
// EA_/EI_/EW_ actions), because onboarding/transaction events are largely
// EA_/EI_ (Android/iOS), not EW_ (web).
//
// STORE SOURCE: `play_installs` holds the Play Store listing's CUMULATIVE
// install badge (e.g. 100,000+) snapshotted every day — it is NOT daily new
// installs, so we use the LATEST snapshot (never a sum). `play_ratings` holds
// the combined Play rating (avg + review count); its per-star breakdown isn't
// provided by the listing (all zeros). App Store is not connected (needs App
// Store Connect / the RU storefront), so it renders "Not connected" rather
// than duplicating Play's numbers.
//
// Anything not sourced is surfaced in a banner and never presented as live.
// ---------------------------------------------------------------------------

interface KPIMetric {
  value: number
  change: number | null
}

interface FunnelStep {
  label: string
  value: number
}

interface RatingBucket {
  label: string
  value: number
}

interface StoreRating {
  store: string
  avgRating: number
  reviewsCount: number
  connected: boolean
}

interface FeatureUsageRow {
  feature: string
  eventName: string
  clicks: number
}

interface RecentActivityRow {
  eventName: string
  eventCount: number
  users: number
}

interface AppPerformanceData {
  totalInstalls: KPIMetric
  installsLifetime: boolean
  installsSourced: boolean
  activeUsers: KPIMetric
  activeUsersSourced: boolean
  avgRating: KPIMetric
  ratingsSourced: boolean
  onboardingRate: KPIMetric
  transactionRate: KPIMetric
  ratesSourced: boolean
  transactingUsers: number
  transactionsByType: { label: string; users: number }[]
  transactionTypesPending: string[]
  usageTrend: AreaChartDataPoint[]
  onboardingFunnel: FunnelStep[]
  onboardingFunnelSourced: boolean
  ratingDistribution: RatingBucket[]
  starBreakdownAvailable: boolean
  starBreakdownFromSample: boolean
  storeRatings: StoreRating[]
  featureUsage: FeatureUsageRow[]
  recentActivity: RecentActivityRow[]
  recentReviews: PlayReviewItem[]
  reviewsSampledCount: number
  toolTabs: ToolTab[]
  hasEvents: boolean
}

function formatTrendDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', timeZone: 'UTC' })
}

/** Previous calendar day (YYYY-MM-DD) — used to make the GA4 prev-period end
 * date exclusive of the current period's first day (GA4 end dates are
 * inclusive, so passing `since` directly overlaps one day). */
function dayBefore(dateStr: string): string {
  const t = new Date(`${dateStr}T00:00:00Z`).getTime()
  return new Date(t - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/** Percent change of current vs previous. Returns null when there's no usable
 * baseline or the swing is implausibly large, instead of a misleading number. */
function pctChange(current: number, previous: number): number | null {
  if (!previous || previous <= 0) return null
  const pct = ((current - previous) / previous) * 100
  if (Math.abs(pct) > 500) return null
  return pct
}

type EventRow = { date: string; event_name: string; event_count: number; users: number }

async function fetchEvents(
  supabase: ReturnType<typeof createServiceClient>,
  gte: string,
  bound: { lte?: string; lt?: string }
): Promise<EventRow[]> {
  const all: EventRow[] = []
  const PAGE = 1000
  for (let p = 0; p < 40; p++) {
    let q = supabase.from('ga_events').select('date, event_name, event_count, users').gte('date', gte)
    if (bound.lte) q = q.lte('date', bound.lte)
    if (bound.lt) q = q.lt('date', bound.lt)
    q = q.order('date', { ascending: true }).range(p * PAGE, p * PAGE + PAGE - 1)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as EventRow[]
    all.push(...rows)
    if (rows.length < PAGE) break
  }
  return all
}

const U = (r: EventRow): string => String(r.event_name ?? '').toUpperCase()
const cnt = (rows: EventRow[], pred: (n: string) => boolean): number =>
  rows.filter((r) => pred(U(r))).reduce((s, r) => s + (Number(r.event_count) || 0), 0)
const usr = (rows: EventRow[], pred: (n: string) => boolean): number =>
  rows.filter((r) => pred(U(r))).reduce((s, r) => s + (Number(r.users) || 0), 0)

async function getAppPerformanceData(searchParams?: { range?: string }): Promise<AppPerformanceData> {
  const supabase = createServiceClient()
  const { startDate: since, endDate: until, prevStartDate } = getDateWindow(searchParams)

  const mockEmpty: AppPerformanceData = {
    totalInstalls: { value: 0, change: null },
    installsLifetime: false,
    installsSourced: false,
    activeUsers: { value: 0, change: null },
    activeUsersSourced: false,
    avgRating: { value: 0, change: null },
    ratingsSourced: false,
    onboardingRate: { value: 0, change: null },
    transactionRate: { value: 0, change: null },
    ratesSourced: false,
    transactingUsers: 0,
    transactionsByType: [],
    transactionTypesPending: [],
    usageTrend: [],
    onboardingFunnel: [],
    onboardingFunnelSourced: false,
    ratingDistribution: [],
    starBreakdownAvailable: false,
    starBreakdownFromSample: false,
    storeRatings: [],
    featureUsage: [],
    recentActivity: [],
    recentReviews: [],
    reviewsSampledCount: 0,
    toolTabs: [],
    hasEvents: false,
  }

  try {
    const [events, prevEvents, installsRes, ratingsRes, activeCur, activePrev, reviews, ga4Funnel, rateInputsCur, rateInputsPrev, txByType] = await Promise.all([
      fetchEvents(supabase, since, { lte: until }),
      fetchEvents(supabase, prevStartDate, { lt: since }),
      supabase.from('play_installs').select('date, installs, country').order('date', { ascending: false }).limit(180),
      supabase
        .from('play_ratings')
        .select('date, avg_rating, total_ratings, star_1, star_2, star_3, star_4, star_5, reviews_count')
        .order('date', { ascending: false })
        .limit(5),
      fetchGA4AppActiveUsersTotal(since, until),
      fetchGA4AppActiveUsersTotal(prevStartDate, dayBefore(since)),
      fetchRecentPlayReviews(2),
      fetchGA4AppOnboardingFunnel(since, until),
      fetchGA4AppRateInputs(since, until),
      fetchGA4AppRateInputs(prevStartDate, dayBefore(since)),
      fetchGA4AppTransactionsByType(since, until),
    ])

    const hasEvents = events.length > 0

    // ---- App metric mapping (admin-editable app_metric_map; fallback defaults).
    // Editing a block's patterns in Admin re-computes every card below. ----
    let appMetricRows: any[] | null = null
    try {
      const mres = await supabase
        .from('app_metric_map')
        .select('key, label, patterns, match_type, description, used_by, sort_order, is_active')
        .eq('is_active', true)
      if (!mres.error) appMetricRows = (mres.data ?? []) as any[]
    } catch {
      // app_metric_map table missing → defaults
    }
    const appMetrics = resolveAppMetrics(appMetricRows)
    const P = (key: string): ((n: string) => boolean) => {
      const d = appMetrics.get(key)
      return d ? (n: string) => matchesAppMetric(d, n) : () => false
    }
    const pFirstOpen = P('first_open')
    const pSession = P('session_start')
    const pOnbComplete = P('onboarding_complete')
    const pDashboard = P('dashboard')
    const pTx = P('transaction')

    // ---- Core event aggregates (config-driven; users-based where it means users) ----
    const firstOpen = cnt(events, pFirstOpen)
    const prevFirstOpen = cnt(prevEvents, pFirstOpen)
    const completeUsers = usr(events, pOnbComplete)
    const prevCompleteUsers = usr(prevEvents, pOnbComplete)
    const dashboardUsers = usr(events, pDashboard)
    const prevDashboardUsers = usr(prevEvents, pDashboard)
    const txUsers = usr(events, pTx)
    const prevTxUsers = usr(prevEvents, pTx)

    // ---- Total Installs: latest store snapshot (lifetime badge), never summed ----
    const installsRows = (installsRes.data ?? []) as any[]
    const allRows = installsRows.filter((r) => r.country === 'ALL')
    const pool = allRows.length > 0 ? allRows : installsRows
    const latestInstall = pool[0] // ordered desc by date
    const priorInstall = pool.find((r) => String(r.date) < since)
    const lifetimeInstalls = latestInstall ? Number(latestInstall.installs) || 0 : 0
    const installsSourced = !!latestInstall && lifetimeInstalls > 0
    const totalInstalls: KPIMetric = installsSourced
      ? { value: lifetimeInstalls, change: priorInstall ? pctChange(lifetimeInstalls, Number(priorInstall.installs) || 0) : null }
      : { value: firstOpen, change: pctChange(firstOpen, prevFirstOpen) }
    const installsLifetime = installsSourced

    // ---- Active Users: authoritative de-duplicated GA4 app metric ----
    const activeUsersSourced = activeCur > 0
    const sessionUsers = usr(events, pSession)
    const prevSessionUsers = usr(prevEvents, pSession)
    const activeUsers: KPIMetric = activeUsersSourced
      ? { value: activeCur, change: pctChange(activeCur, activePrev) }
      : { value: sessionUsers, change: pctChange(sessionUsers, prevSessionUsers) }

    // ---- Avg Rating (Play Store) ----
    const ratings = (ratingsRes.data ?? []) as any[]
    const latestRating = ratings[0]
    const prevRating = ratings[1]
    const ratingsSourced = !!latestRating
    const avgRating: KPIMetric = ratingsSourced
      ? {
          value: Number(latestRating.avg_rating) || 0,
          change: prevRating ? pctChange(Number(latestRating.avg_rating) || 0, Number(prevRating.avg_rating) || 0) : null,
        }
      : { value: 0, change: null }

    // ---- Onboarding Rate = onboarding-complete users / NEW USER SIGNUP.
    // Denominator is the funnel's top stage (users who STARTED signup), not
    // first_open installs — so this equals the funnel's overall finish rate and
    // answers "of people who began signup, how many completed onboarding". Uses
    // GA4 PERIOD-WIDE UNIQUE users (Android/iOS), same de-dup method as the funnel;
    // falls back to ga_events sums only if GA4 is unavailable (flagged in banner). ----
    const pSignupFallback = (n: string) =>
      n.includes('ONBOARDING_LETS_GO') || n.includes('ONBOARDING_SOCIAL_SIGNUP') || n.includes('ONBOARDING_IMPORT_WALLET')
    const ratesSourced = !!rateInputsCur
    const onbNumCur = rateInputsCur ? rateInputsCur.complete : completeUsers
    const onbDenCur = rateInputsCur ? rateInputsCur.signupStarted : usr(events, pSignupFallback)
    const onbNumPrev = rateInputsPrev ? rateInputsPrev.complete : prevCompleteUsers
    const onbDenPrev = rateInputsPrev ? rateInputsPrev.signupStarted : usr(prevEvents, pSignupFallback)
    const onbCur = onbDenCur > 0 ? (onbNumCur / onbDenCur) * 100 : 0
    const onbPrev = onbDenPrev > 0 ? (onbNumPrev / onbDenPrev) * 100 : 0
    const onboardingRate: KPIMetric = { value: onbCur, change: pctChange(onbCur, onbPrev) }

    // ---- Transaction Rate = transacting users / users reaching dashboard.
    // Same GA4 period-wide unique method (Android/iOS), with ga_events fallback. ----
    const txNumCur = rateInputsCur ? rateInputsCur.tx : txUsers
    const txDenCur = rateInputsCur ? rateInputsCur.dashboard : dashboardUsers
    const txNumPrev = rateInputsPrev ? rateInputsPrev.tx : prevTxUsers
    const txDenPrev = rateInputsPrev ? rateInputsPrev.dashboard : prevDashboardUsers
    const txCur = txDenCur > 0 ? (txNumCur / txDenCur) * 100 : 0
    const txPrev = txDenPrev > 0 ? (txNumPrev / txDenPrev) * 100 : 0
    const transactionRate: KPIMetric = { value: txCur, change: pctChange(txCur, txPrev) }

    // ---- Transacting users (union total) + per-type breakdown (completed
    // transactions, GA4 period-wide unique, Android/iOS). The union total is a
    // de-dup across types, so it is <= the sum of the per-type counts. Inactive
    // types (MIRO/eSIM/Coinformance) are listed as pending until the dev emits
    // their SEND events. ----
    const transactingUsers = txNumCur
    const transactionsByType = (txByType ?? []).map((t) => ({ label: t.label, users: t.users }))
    const transactionTypesPending = APP_TRANSACTION_TYPES.filter((t) => !t.active).map((t) => t.label)

    // ---- Trend: daily new installs (first_open) vs daily active users (session_start users) ----
    const byDate = new Map<string, { installs: number; active: number }>()
    for (const row of events) {
      const n = U(row)
      const isFo = pFirstOpen(n)
      const isSs = pSession(n)
      if (!isFo && !isSs) continue
      const e = byDate.get(row.date) ?? { installs: 0, active: 0 }
      if (isFo) e.installs += Number(row.event_count) || 0
      if (isSs) e.active += Number(row.users) || 0
      byDate.set(row.date, e)
    }
    const usageTrend: AreaChartDataPoint[] = Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, e]) => ({ date: formatTrendDate(date), value: e.installs, secondaryValue: e.active }))

    // ---- New-user onboarding DROP-OFF — Android & iOS only.
    // Every new-user path (Let's Go / Social Signup / Import Wallet) enters the
    // signup flow and converges on creating a 6-digit passcode
    // (SETTINGS_NEW_PASSCODE) — returning users never create one — then finishes
    // at ONBOARDING_GUIDE_COMPLETE.
    //
    // CORRECT SOURCE: GA4 directly (fetchGA4AppOnboardingFunnel), which returns,
    // per stage, the PERIOD-WIDE UNIQUE users — the distinct users who fired any
    // of that stage's events across the whole range, counted once for the period.
    // This matches a GA4 Explore "Total" (Active users by Event name, no Date
    // dimension), so a manager cross-checking in GA4 sees the same number.
    // `ga_events` cannot express that union (no user id; date+event_name grain
    // only), so summing its per-event `users` rows double-counts; we fall back to
    // it only if GA4 is unavailable, and flag the funnel as unsourced so the
    // copy/caveat make that explicit. ----
    const pSignupStarted = (n: string) =>
      n.includes('ONBOARDING_LETS_GO') || n.includes('ONBOARDING_SOCIAL_SIGNUP') || n.includes('ONBOARDING_IMPORT_WALLET')
    const pPasscodeCreated = (n: string) => n.includes('SETTINGS_NEW_PASSCODE')
    const funnelSignupStarted = ga4Funnel ? ga4Funnel.signupStarted : usr(events, pSignupStarted)
    const funnelPasscodeCreated = ga4Funnel ? ga4Funnel.passcodeCreated : usr(events, pPasscodeCreated)
    const funnelOnboardingComplete = ga4Funnel ? ga4Funnel.onboardingComplete : completeUsers
    const onboardingFunnelSourced = !!ga4Funnel
    const onboardingFunnel: FunnelStep[] = [
      { label: 'New user signup', value: funnelSignupStarted },
      { label: 'Passcode created', value: funnelPasscodeCreated },
      { label: 'Onboarding complete', value: funnelOnboardingComplete },
    ]

    // ---- Rating distribution (star breakdown often unavailable → all zeros) ----
    // Prefer a real star distribution from the recent-reviews sample (Android
    // Publisher API); fall back to any stored star columns (usually empty).
    const sampleStars = reviews.sampledCount > 0
    const ratingDistribution: RatingBucket[] = sampleStars
      ? [
          { label: '5 star', value: reviews.distribution.star5 },
          { label: '4 star', value: reviews.distribution.star4 },
          { label: '3 star', value: reviews.distribution.star3 },
          { label: '2 star', value: reviews.distribution.star2 },
          { label: '1 star', value: reviews.distribution.star1 },
        ]
      : latestRating
        ? [
            { label: '5 star', value: Number(latestRating.star_5) || 0 },
            { label: '4 star', value: Number(latestRating.star_4) || 0 },
            { label: '3 star', value: Number(latestRating.star_3) || 0 },
            { label: '2 star', value: Number(latestRating.star_2) || 0 },
            { label: '1 star', value: Number(latestRating.star_1) || 0 },
          ]
        : []
    const starBreakdownFromSample = sampleStars
    const starBreakdownAvailable = ratingDistribution.some((s) => s.value > 0)

    const storeRatings: StoreRating[] = [
      {
        store: 'Google Play',
        avgRating: ratingsSourced ? Number(latestRating.avg_rating) || 0 : 0,
        reviewsCount: ratingsSourced ? Number(latestRating.reviews_count) || 0 : 0,
        connected: ratingsSourced,
      },
      // App Store isn't sourced (needs App Store Connect / RU storefront).
      { store: 'App Store', avgRating: 0, reviewsCount: 0, connected: false },
    ]

    // ---- Feature usage (tile clicks): accumulate raw E?_T_* tile events here;
    // they're grouped BY TOOL below (once the tool mapping is resolved) so each
    // tool shows once with a clean name instead of fragmented raw event labels. ----
    const tileTotals = new Map<string, number>()
    for (const row of events) {
      if (!/^E[AIW]_T_/.test(U(row))) continue
      tileTotals.set(row.event_name, (tileTotals.get(row.event_name) ?? 0) + (Number(row.event_count) || 0))
    }

    // ---- Recent activity: top events on the most recent day with data ----
    const latestEventDate = events.reduce<string | null>((latest, r) => (!latest || r.date > latest ? r.date : latest), null)
    const latestDayRows = latestEventDate ? events.filter((r) => r.date === latestEventDate) : []
    const recentActivity: RecentActivityRow[] = latestDayRows
      .map((r) => ({ eventName: r.event_name, eventCount: Number(r.event_count) || 0, users: Number(r.users) || 0 }))
      .sort((a, b) => b.eventCount - a.eventCount)
      .slice(0, 10)

    // ---- Tool usage (admin-configurable mapping; fallback to defaults) ----
    let toolMappings: ToolMapping[] = DEFAULT_TOOL_MAPPINGS
    try {
      const cfg = await supabase
        .from('tool_usage_config')
        .select('tool, patterns, sort_order, is_active')
        .eq('is_active', true)
      const cfgRows = (cfg.error ? [] : (cfg.data ?? [])) as any[]
      if (cfgRows.length > 0) {
        toolMappings = cfgRows.map((r) => ({
          tool: String(r.tool),
          patterns: String(r.patterns ?? '')
            .split(',')
            .map((s: string) => s.trim().toUpperCase())
            .filter(Boolean),
          sortOrder: Number(r.sort_order) || 0,
          isActive: r.is_active !== false,
        }))
      }
    } catch {
      // tool_usage_config table missing → use defaults
    }
    const toolTabs = computeToolTabs(events, toolMappings)

    // ---- Feature usage BY TOOL: group the raw tile clicks using the SAME
    // mapping as the Tool Usage tabs (first-match-wins). Each tool appears once
    // with its clean display name; tile clicks that map to no tool are pooled
    // into a single "Other tiles" bar so nothing is dropped or fragmented. ----
    const featureTotals = new Map<string, number>()
    let otherTileClicks = 0
    Array.from(tileTotals.entries()).forEach(([eventName, clicks]) => {
      const tool = toolForEventName(eventName, toolMappings)
      if (tool) featureTotals.set(tool, (featureTotals.get(tool) ?? 0) + clicks)
      else otherTileClicks += clicks
    })
    const featureUsage: FeatureUsageRow[] = Array.from(featureTotals.entries())
      .map(([feature, clicks]) => ({ feature, eventName: feature, clicks }))
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, 13)
    if (otherTileClicks > 0) featureUsage.push({ feature: 'Other tiles', eventName: '__other__', clicks: otherTileClicks })

    return {
      totalInstalls,
      installsLifetime,
      installsSourced,
      activeUsers,
      activeUsersSourced,
      avgRating,
      ratingsSourced,
      onboardingRate,
      transactionRate,
      ratesSourced,
      transactingUsers,
      transactionsByType,
      transactionTypesPending,
      usageTrend,
      onboardingFunnel,
      onboardingFunnelSourced,
      ratingDistribution,
      starBreakdownAvailable,
      starBreakdownFromSample,
      storeRatings,
      featureUsage,
      recentActivity,
      recentReviews: reviews.reviews,
      reviewsSampledCount: reviews.sampledCount,
      toolTabs,
      hasEvents,
    }
  } catch {
    return mockEmpty
  }
}

function getTrend(change: number | null): 'up' | 'down' | 'flat' {
  if (!change) return 'flat'
  if (change > 0) return 'up'
  if (change < 0) return 'down'
  return 'flat'
}

const RECENT_ACTIVITY_COLUMNS: DataTableColumn[] = [
  { key: 'eventName', label: 'Event Name', align: 'left', sortable: true },
  { key: 'eventCount', label: 'Event Count', align: 'right', sortable: true },
  { key: 'users', label: 'Users', align: 'right', sortable: true },
]

const RANGE_LABELS: Record<string, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  '7d': 'Last 7 Days',
  '30d': 'Last 30 Days',
  '90d': 'Last 90 Days',
}

export default async function AppPerformancePage({
  searchParams,
}: {
  searchParams: { range?: string }
}) {
  const data = await getAppPerformanceData(searchParams)
  const rangeLabel = RANGE_LABELS[searchParams?.range ?? '30d'] ?? 'Last 30 Days'
  const { startDate: rangeStart, endDate: rangeEnd } = getDateWindow(searchParams)
  const rangeDays = Math.max(
    1,
    Math.round((new Date(rangeEnd).getTime() - new Date(rangeStart).getTime()) / 86400000) + 1,
  )

  // Cone geometry for the onboarding drop-off funnel (server-rendered bands,
  // same inverted-triangle style as the User Journey page).
  const funnelStages = data.onboardingFunnel
  const fN = funnelStages.length
  const F_TOP = 100
  const F_TIP = 42
  const fBoundary = (k: number): number => (fN <= 0 ? F_TOP : F_TOP - (k * (F_TOP - F_TIP)) / fN)
  const FUNNEL_COLORS: { from: string; to: string }[] = [
    { from: '#015E8C', to: '#0176B0' },
    { from: '#0E8FB8', to: '#2FA6B0' },
    { from: '#B07E33', to: '#C28E40' },
  ]
  // Stage-to-stage conversion for the new-user drop-off funnel.
  const funnelStarted = data.onboardingFunnel[0]?.value ?? 0
  const funnelPasscode = data.onboardingFunnel[1]?.value ?? 0
  const funnelComplete = data.onboardingFunnel[2]?.value ?? 0
  const convPct = (num: number, den: number): number => (den > 0 ? Math.round((num / den) * 100) : 0)
  const featureUsageBars: BarChartDataPoint[] = data.featureUsage.map((r) => ({ label: r.feature, value: r.clicks }))
  const recentActivityRows = data.recentActivity.map((row) => ({
    eventName: row.eventName,
    eventCount: formatNumber(row.eventCount),
    users: formatNumber(row.users),
  }))

  const notLive: string[] = []
  if (!data.hasEvents) notLive.push('No GA4 app events for this period — figures may be incomplete.')
  if (!data.installsSourced) notLive.push('Total Installs uses the GA4 first_open proxy — the Play Store install count is not synced.')
  if (!data.ratingsSourced) notLive.push('Store ratings are not synced yet.')
  if (data.ratingsSourced && !data.starBreakdownAvailable) notLive.push('Rating star breakdown is not provided by the Play Store listing (shows blanks).')
  notLive.push('App Store is not connected (needs App Store Connect / the Russian storefront) — its card shows “Not connected”.')
  if (!data.activeUsersSourced) notLive.push('Active Users falls back to session users (the GA4 app active-users metric is unavailable).')
  if (data.hasEvents && !data.onboardingFunnelSourced) notLive.push('The onboarding funnel fell back to summed ga_events user rows (GA4 was unavailable), which can double-count a user across signup paths and is not the period-wide unique count.')
  if (data.hasEvents && !data.ratesSourced) notLive.push('Onboarding Rate and Transaction Rate fell back to summed ga_events user rows (GA4 was unavailable), which over-counts and is not the period-wide unique rate.')

  return (
    <div>
      <Header title="App Performance" />

      {notLive.length > 0 && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-800">Some data isn&apos;t fully connected</p>
          <ul className="mt-1 list-disc pl-5 text-xs text-amber-700">
            {notLive.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}

      {/* KPI cards row */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <KPICard
          title={data.installsLifetime ? 'Total Installs (lifetime)' : 'New Installs (period)'}
          value={formatNumber(data.totalInstalls.value)}
          change={data.totalInstalls.change ?? undefined}
          changeValue={deltaFromPct(data.totalInstalls.value, data.totalInstalls.change)}
          trend={getTrend(data.totalInstalls.change)}
          iconName="smartphone"
          tooltip={
            data.installsLifetime
              ? 'Cumulative installs from the Play Store listing (latest snapshot — an approximate badge like 100,000+, not summed). App Store not included.'
              : 'New installs this period, proxied by GA4 first_open (Play Store install count not synced).'
          }
        />
        <KPICard
          title="Active Users"
          value={formatNumber(data.activeUsers.value)}
          change={data.activeUsers.change ?? undefined}
          changeValue={deltaFromPct(data.activeUsers.value, data.activeUsers.change)}
          trend={getTrend(data.activeUsers.change)}
          iconName="users"
          tooltip="De-duplicated active users of the Sahal Wallet app for this period (GA4 app property)."
        />
        <KPICard
          title="Avg Rating"
          value={data.ratingsSourced ? data.avgRating.value.toFixed(1) : '—'}
          change={data.avgRating.change ?? undefined}
          changeValue={deltaFromPct(data.avgRating.value, data.avgRating.change)}
          trend={getTrend(data.avgRating.change)}
          iconName="trending-up"
          tooltip="Average Play Store star rating (out of 5). App Store not connected."
        />
        <KPICard
          title="Onboarding Rate"
          value={formatPercent(data.onboardingRate.value)}
          change={data.onboardingRate.change ?? undefined}
          changeValue={deltaFromPct(data.onboardingRate.value, data.onboardingRate.change)}
          trend={getTrend(data.onboardingRate.change)}
          iconName="filter"
          tooltip="Onboarding completions ÷ new user signups, as GA4 period-wide unique users (Android/iOS): *_ONBOARDING_GUIDE_COMPLETE ÷ users who started signup. Equals the funnel's overall finish rate; cross-checks against a GA4 Explore Total."
        />
        <KPICard
          title="Transaction Rate"
          value={formatPercent(data.transactionRate.value)}
          change={data.transactionRate.change ?? undefined}
          changeValue={deltaFromPct(data.transactionRate.value, data.transactionRate.change)}
          trend={getTrend(data.transactionRate.change)}
          iconName="dollar-sign"
          tooltip="Transacting users ÷ users reaching the dashboard, as GA4 period-wide unique users (Android/iOS). Transacting = completed a transaction (E[AI]_SEND_*) in Swap, Sahal Stake, MRHB Store or Emplifai. MIRO / eSIM / Coinformance are pending their SEND events. A behavioural rate, not revenue."
        />
      </div>

      {/* Install / active users trend */}
      <div className="mb-6">
        <AreaChart
          data={data.usageTrend}
          title="New Installs vs. Active Users (daily)"
          color="#01A6FA"
          fillColor="#D0EFFF"
          seriesLabel="New Installs (first_open)"
          secondarySeriesLabel="Active Users (daily)"
          secondaryColor="#E5B897"
          height={320}
        />
      </div>

      {/* Tool Usage — per-tool tabs, each with its own cards + range-aware trend */}
      {data.toolTabs.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-1 text-lg font-semibold text-mrhb-dark">
            Tool Usage <span className="text-xs font-normal text-mrhb-dark/40">&middot; {rangeLabel}</span>
          </h2>
          <p className="mb-4 text-xs text-mrhb-dark/50">
            Per-tool engagement (GA4 app events, all platforms) for the selected range — switch the date range at
            the top to update every tool&rsquo;s trend. Pick a tool tab to see its cards + daily trend. &ldquo;Active
            Users&rdquo; is summed daily active (a ceiling); mapping is editable in Admin.
          </p>
          <ToolUsageTabs tools={data.toolTabs} rangeLabel={rangeLabel} rangeDays={rangeDays} />
        </div>
      )}

      {/* New-user onboarding drop-off funnel — cone style */}
      <div className="mb-6 overflow-hidden rounded-2xl bg-mrhb-white shadow-sm ring-1 ring-mrhb-warm-grey/10">
        <div className="flex flex-col gap-1 border-b border-mrhb-warm-grey/10 bg-gradient-to-r from-mrhb-blue/5 to-transparent px-6 py-5">
          <h2 className="text-lg font-semibold text-mrhb-dark">New User Onboarding — Drop-off</h2>
          <p className="text-xs text-mrhb-dark/50">{rangeLabel} · Android &amp; iOS · new-user signup flow · % of starters</p>
        </div>

        <div className="px-4 py-8 sm:px-6">
          {funnelStarted <= 0 ? (
            <p className="py-10 text-center text-sm text-mrhb-dark/50">No new-user signups in this period.</p>
          ) : (
            <div className="mx-auto flex w-full max-w-xl flex-col gap-[3px]">
              {funnelStages.map((stage, index) => {
                const colors = FUNNEL_COLORS[index] ?? { from: '#0176B0', to: '#0192D6' }
                const topW = fBoundary(index)
                const botW = fBoundary(index + 1)
                const leftTop = (100 - topW) / 2
                const rightTop = (100 + topW) / 2
                const leftBot = (100 - botW) / 2
                const rightBot = (100 + botW) / 2
                const clip = `polygon(${leftTop}% 0, ${rightTop}% 0, ${rightBot}% 100%, ${leftBot}% 100%)`
                const textW = Math.max(46, (topW + botW) / 2 - 3)
                const shareOfTop = funnelStarted > 0 ? (stage.value / funnelStarted) * 100 : 0
                const next = funnelStages[index + 1]

                return (
                  <div key={stage.label}>
                    <div className="relative h-[96px] w-full">
                      <div
                        className="absolute inset-0"
                        style={{
                          clipPath: clip,
                          WebkitClipPath: clip,
                          backgroundImage: `linear-gradient(135deg, ${colors.from}, ${colors.to})`,
                        }}
                      />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="text-center leading-tight text-white" style={{ width: `${textW}%` }}>
                          <div className="text-lg font-bold drop-shadow sm:text-xl">{stage.label}</div>
                          <div className="mt-0.5 text-sm font-bold text-white drop-shadow sm:text-base">
                            {formatNumber(stage.value)}
                            <span className="ml-1.5 font-semibold text-white/85">
                              · {shareOfTop.toFixed(shareOfTop >= 10 ? 0 : 1)}%
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                    {next && (
                      <div className="flex items-center justify-center gap-1.5 py-1 text-[11px] font-semibold tracking-wide text-mrhb-dark/45">
                        <span aria-hidden="true">↓</span>
                        <span>{convPct(next.value, stage.value)}% continue</span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {funnelStarted > 0 && (
            <div className="mx-auto mt-5 flex max-w-xl flex-wrap items-center justify-center gap-2 text-xs">
              <span className="rounded-full bg-mrhb-blue-light px-2.5 py-1 font-medium text-mrhb-blue">
                Signup → Passcode: {convPct(funnelPasscode, funnelStarted)}%
              </span>
              <span className="rounded-full bg-mrhb-blue-light px-2.5 py-1 font-medium text-mrhb-blue">
                Passcode → Complete: {convPct(funnelComplete, funnelPasscode)}%
              </span>
              <span className="rounded-full bg-mrhb-blue px-2.5 py-1 font-medium text-mrhb-white">
                Overall: {convPct(funnelComplete, funnelStarted)}% finish
              </span>
            </div>
          )}

          <p className="mx-auto mt-4 max-w-xl text-xs text-mrhb-dark/50">
            Android &amp; iOS only. Each stage is the period-wide unique-user count: the distinct users who triggered
            that stage&rsquo;s events at least once across the range, counted once for the whole period — the same number
            GA4 shows in the &ldquo;Total&rdquo; row of an Active-users-by-Event-name report.
            &ldquo;New user signup&rdquo; = users who began any path (Let&apos;s Go, Social Signup or Import Wallet);
            &ldquo;Passcode created&rdquo; = the create-6-digit-passcode step (*_SETTINGS_NEW_PASSCODE) that every new
            user hits and returning users never do; &ldquo;Onboarding complete&rdquo; = *_ONBOARDING_GUIDE_COMPLETE
            (fires on dashboard arrival). To cross-check in GA4, filter Event name to a stage&rsquo;s events with
            Platform = Android/iOS and read the Active-users Total. These are GA4 signals and undercount your
            backend&apos;s registered-signup total, so read them as drop-off ratios, not the authoritative signup count.
          </p>
        </div>
      </div>

      {/* Transactions by type — completed transactions (GA4 period-wide unique) */}
      <div className="mb-6 overflow-hidden rounded-2xl bg-mrhb-white shadow-sm ring-1 ring-mrhb-warm-grey/10">
        <div className="flex flex-col gap-1 border-b border-mrhb-warm-grey/10 bg-gradient-to-r from-mrhb-blue/5 to-transparent px-6 py-5">
          <h2 className="text-lg font-semibold text-mrhb-dark">Transactions by Type</h2>
          <p className="text-xs text-mrhb-dark/50">
            {rangeLabel} · Android &amp; iOS · completed transactions (GA4 period-wide unique) ·{' '}
            {formatNumber(data.transactingUsers)} unique transacting users
          </p>
        </div>
        <div className="px-4 py-6 sm:px-6">
          {data.transactionsByType.length === 0 ? (
            <p className="py-6 text-center text-sm text-mrhb-dark/50">No completed transactions in this period.</p>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {data.transactionsByType.map((t) => {
                const share = data.transactingUsers > 0 ? (t.users / data.transactingUsers) * 100 : 0
                return (
                  <div key={t.label} className="rounded-xl bg-mrhb-cream/40 p-4 ring-1 ring-mrhb-warm-grey/10">
                    <p className="text-sm font-medium text-mrhb-dark/60">{t.label}</p>
                    <p className="mt-1 text-2xl font-semibold text-mrhb-dark">{formatNumber(t.users)}</p>
                    <p className="mt-0.5 text-xs text-mrhb-dark/45">{share.toFixed(share >= 10 ? 0 : 1)}% of transactors</p>
                  </div>
                )
              })}
            </div>
          )}
          {data.transactionTypesPending.length > 0 && (
            <p className="mt-4 text-xs text-mrhb-dark/50">
              Coming soon (pending dev SEND events): {data.transactionTypesPending.join(', ')}.
            </p>
          )}
          <p className="mt-2 text-xs text-mrhb-dark/45">
            Each tile counts users who completed a transaction (E[AI]_SEND_&hellip;) in that tool, de-duplicated per
            period. The headline &ldquo;unique transacting users&rdquo; de-duplicates across tools, so it is smaller
            than the sum of the tiles.
          </p>
        </div>
      </div>

      {/* Ratings */}
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          {data.starBreakdownAvailable ? (
            <>
              <BarChart data={data.ratingDistribution} title="Rating Distribution" color="#E5B897" height={280} layout="horizontal" />
              {data.starBreakdownFromSample && (
                <p className="mt-2 text-xs text-mrhb-dark/50">
                  Based on the {formatNumber(data.reviewsSampledCount)} most recent reviews (Android Publisher API) — a
                  sample, not the full all-time histogram. The headline average uses the store-listing aggregate.
                </p>
              )}
            </>
          ) : (
            <div className="flex h-full min-h-[200px] flex-col justify-center rounded-xl bg-mrhb-white p-5 shadow-sm">
              <h3 className="mb-2 text-base font-semibold text-mrhb-dark">Rating Distribution</h3>
              <p className="text-sm text-mrhb-dark/50">
                A star-by-star breakdown isn&apos;t available yet (no recent reviews returned). The average rating and
                review count above are live.
              </p>
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {data.storeRatings.map((store) => (
            <div
              key={store.store}
              className={`rounded-xl p-5 shadow-sm ${store.connected ? 'bg-mrhb-white' : 'border border-dashed border-mrhb-warm-grey/50 bg-mrhb-cream/40'}`}
            >
              <p className="text-sm font-medium text-mrhb-dark/60">{store.store}</p>
              {store.connected ? (
                <>
                  <div className="mt-2 flex items-baseline gap-2">
                    <p className="text-2xl font-semibold text-mrhb-dark">{store.avgRating.toFixed(1)}</p>
                    <span className="text-mrhb-warm-tan">★</span>
                  </div>
                  <p className="mt-1 text-xs text-mrhb-dark/50">{formatNumber(store.reviewsCount)} reviews</p>
                </>
              ) : (
                <div className="mt-2">
                  <span className="inline-flex items-center rounded-full bg-mrhb-warm-grey/20 px-2.5 py-1 text-[11px] font-semibold text-mrhb-dark/50">
                    Not connected
                  </span>
                  <p className="mt-2 text-xs text-mrhb-dark/50">Needs App Store Connect (Russian storefront).</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Recent reviews (Play Store, Android Publisher API) */}
      {data.recentReviews.length > 0 && (
        <div className="mb-6 rounded-xl bg-mrhb-white p-5 shadow-sm">
          <h3 className="mb-4 text-base font-semibold text-mrhb-dark">
            Recent Reviews <span className="text-xs font-normal text-mrhb-dark/40">&middot; Play Store</span>
          </h3>
          <ul className="space-y-3">
            {data.recentReviews.slice(0, 8).map((rv, i) => (
              <li key={`${rv.author}-${rv.date}-${i}`} className="rounded-lg border border-mrhb-warm-grey/15 p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm font-medium text-mrhb-dark">{rv.author}</span>
                  <span className="flex-shrink-0 text-sm">
                    <span className="text-mrhb-warm-tan">{'★'.repeat(rv.rating)}</span>
                    <span className="text-mrhb-warm-grey/40">{'★'.repeat(Math.max(0, 5 - rv.rating))}</span>
                  </span>
                </div>
                {rv.text && <p className="mt-1 text-xs leading-snug text-mrhb-dark/70">{rv.text}</p>}
                <p className="mt-1 text-[11px] text-mrhb-dark/40">
                  {[rv.date, rv.version ? `v${rv.version}` : null, rv.device].filter(Boolean).join(' · ')}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Feature usage — tile clicks grouped by tool */}
      {featureUsageBars.length > 0 && (
        <div className="mb-6">
          <BarChart data={featureUsageBars} title="Tile Clicks by Tool" color="#01A6FA" height={320} layout="vertical" valueLabel="Tile Clicks" />
        </div>
      )}

      {/* Recent activity */}
      <div>
        <DataTable
          columns={RECENT_ACTIVITY_COLUMNS}
          data={recentActivityRows}
          title="Recent Activity (Most Recent Day)"
          emptyMessage="No event data available for this period."
        />
      </div>
    </div>
  )
}
