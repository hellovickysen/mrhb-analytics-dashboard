import Header from '@/components/layout/Header'
import KPICard from '@/components/cards/KPICard'
import BarChart, { type BarChartDataPoint } from '@/components/charts/BarChart'
import DataTable, { type DataTableColumn } from '@/components/tables/DataTable'
import { formatNumber } from '@/lib/utils/format'
import { createServiceClient } from '@/lib/supabase/server'
import { getDateWindow } from '@/lib/utils/date-range'

// ---------------------------------------------------------------------------
// User Journey (reworked)
// ---------------------------------------------------------------------------
// Server Component. The old page presented a single monotonic "funnel" that
// stitched four UNRELATED sources (Short.io clicks -> GA4 web sessions ->
// Firebase app events -> a 7-day session proxy) into one cohort with fabricated
// conversion %s, silently substituted mock numbers per stage, queried the wrong
// (EW_) event prefixes so real Android/iOS onboarding+transaction events summed
// to ~0, and inflated the top stage ~6x by reading Short.io's `domain_total`
// aggregate instead of the authoritative per-range figure.
//
// This rework instead reports TWO clearly-separated, correctly-sourced tracks
// and never presents mock as live:
//
//   Track A — Web acquisition (Short.io + GA4 web):
//     • Social link clicks   = authoritative Short.io range_<range> snapshot
//                              (matches the Social page).
//     • Social+referral web sessions = ga_traffic (website), channels
//                              'Organic Social' + 'Referral' (there is no
//                              'Social' channel in GA4).
//
//   Track B — App engagement (Firebase, ALL platforms SA/SI/SW + EA/EI/EW/EE):
//     first_open (installs) → Get Started → Onboarding started/completed →
//     Dashboard reached → Transaction activity → Returning. Event names are
//     matched platform-agnostically (see RULES), and each milestone shows both
//     the raw event count and GA4's per-event `users`.
//
// IMPORTANT (shown to users as a disclaimer): these tracks are NOT a single
// tracked cohort. The app track measures the WHOLE active user base's events in
// the window, not only users who installed in this window — so later milestones
// can (and do) exceed installs. `users` is GA4's per-event user metric summed
// over days: a ceiling, not a true unique-in-period count.
//
// All reads are bounded on both ends of the window. No per-stage mock: unsynced
// sources render real zeros behind a clearly-labelled banner.

interface Milestone {
  key: string
  label: string
  basis: string
  count: number
  users: number
}

interface JourneyData {
  // Track A
  socialClicksTotal: number
  socialClicksHuman: number
  socialReferralSessions: number
  webSourced: boolean
  // Track B
  milestones: Milestone[]
  appSourced: boolean
  // Attribution
  attribution: { platform: string; clicks: number }[]
  ga4SocialSessions: number
}

/** Case-insensitive substring test against an event name. */
function has(name: string, needle: string): boolean {
  return name.indexOf(needle) !== -1
}

/**
 * Fetches all rows of a table for a window, paginating past Supabase's
 * 1,000-row-per-request cap.
 */
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
  const empty: JourneyData = {
    socialClicksTotal: 0,
    socialClicksHuman: 0,
    socialReferralSessions: 0,
    webSourced: false,
    milestones: [],
    appSourced: false,
    attribution: [],
    ga4SocialSessions: 0,
  }

  try {
    const supabase = createServiceClient()
    const { startDate: since, endDate: until } = getDateWindow(searchParams)

    const [events, shortioRangeRes, sessionsRes, bySocialRes, gaSocialRes] = await Promise.all([
      fetchAll(supabase, 'ga_events', 'date, event_name, event_count, users', since, until),
      supabase
        .from('shortio_clicks')
        .select('total_clicks, human_clicks')
        .eq('link_id', `range_${rangeKey}`)
        .order('date', { ascending: false })
        .limit(1),
      supabase
        .from('ga_traffic')
        .select('sessions')
        .gte('date', since)
        .lte('date', until)
        .in('channel', ['Organic Social', 'Referral']),
      supabase
        .from('shortio_clicks')
        .select('date, link_id, referrer, total_clicks')
        .in('link_id', [`by_social_${rangeKey}`, 'by_social'])
        .order('date', { ascending: false }),
      supabase
        .from('ga_traffic')
        .select('sessions')
        .gte('date', since)
        .lte('date', until)
        .eq('channel', 'Organic Social'),
    ])

    // ---- Track B: app milestones (all-platform event rules) ----
    const B = {
      installs: { count: 0, users: 0 },
      getStarted: { count: 0, users: 0 },
      onboardingStarted: { count: 0, users: 0 },
      onboardingComplete: { count: 0, users: 0 },
      dashboard: { count: 0, users: 0 },
      transaction: { count: 0, users: 0 },
      returning: { count: 0, users: 0 },
    }
    for (const r of events) {
      const n = String(r.event_name ?? '').toUpperCase()
      const c = Number(r.event_count) || 0
      const u = Number(r.users) || 0
      const bump = (b: { count: number; users: number }) => {
        b.count += c
        b.users += u
      }
      if (n === 'FIRST_OPEN') bump(B.installs)
      if (has(n, 'GET_STARTED')) bump(B.getStarted)
      if (has(n, 'ONBOARDING_LETS_GO')) bump(B.onboardingStarted)
      if (has(n, 'ONBOARDING_GUIDE_COMPLETE')) bump(B.onboardingComplete)
      if (has(n, 'APP_DASHBOARD')) bump(B.dashboard)
      if (has(n, 'SEND_MONEY') || has(n, '_SEND_') || has(n, 'SWAP') || has(n, 'SAHAL_RAMP')) bump(B.transaction)
      if (n === 'SESSION_START') bump(B.returning)
    }

    const milestones: Milestone[] = [
      { key: 'installs', label: 'App installs (first open)', basis: 'first_open', ...B.installs },
      { key: 'getStarted', label: 'Reached Get Started', basis: '*_GET_STARTED screens', ...B.getStarted },
      { key: 'onboardingStarted', label: 'Onboarding started', basis: '*_ONBOARDING_LETS_GO', ...B.onboardingStarted },
      { key: 'onboardingComplete', label: 'Onboarding completed', basis: '*_ONBOARDING_GUIDE_COMPLETE', ...B.onboardingComplete },
      { key: 'dashboard', label: 'Reached dashboard', basis: '*_APP_DASHBOARD screens', ...B.dashboard },
      { key: 'transaction', label: 'Transaction activity', basis: 'send / swap / ramp events (incl. in-flow screens)', ...B.transaction },
      { key: 'returning', label: 'Returning sessions', basis: 'session_start', ...B.returning },
    ]
    const appSourced = events.length > 0 && milestones.some((m) => m.count > 0)

    // ---- Track A: web acquisition ----
    const rangeRow = shortioRangeRes.data?.[0] as { total_clicks: number; human_clicks: number } | undefined
    const socialClicksTotal = Number(rangeRow?.total_clicks) || 0
    const socialClicksHuman = Number(rangeRow?.human_clicks) || 0
    const socialReferralSessions = (sessionsRes.data ?? []).reduce(
      (s: number, r: any) => s + (Number(r.sessions) || 0),
      0
    )
    const webSourced = rangeRow !== undefined || socialReferralSessions > 0

    // ---- Attribution: Short.io per-platform clicks (latest snapshot) ----
    const socRows = (bySocialRes.data ?? []) as any[]
    const latestDate = socRows.reduce((m, r) => (String(r.date) > m ? String(r.date) : m), '')
    const perRange = socRows.filter((r) => r.date === latestDate && r.link_id === `by_social_${rangeKey}`)
    const fallback = socRows.filter((r) => r.date === latestDate && r.link_id === 'by_social')
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

    const ga4SocialSessions = (gaSocialRes.data ?? []).reduce(
      (s: number, r: any) => s + (Number(r.sessions) || 0),
      0
    )

    return {
      socialClicksTotal,
      socialClicksHuman,
      socialReferralSessions,
      webSourced,
      milestones,
      appSourced,
      attribution,
      ga4SocialSessions,
    }
  } catch {
    return empty
  }
}

const RANGE_LABELS: Record<string, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  '7d': 'Last 7 Days',
  '30d': 'Last 30 Days',
  '90d': 'Last 90 Days',
}

const milestoneColumns: DataTableColumn[] = [
  { key: 'milestone', label: 'Milestone', sortable: false },
  { key: 'users', label: 'Active Users', sortable: true, align: 'right' },
  { key: 'events', label: 'Events', sortable: true, align: 'right' },
  { key: 'basis', label: 'Event basis', sortable: false },
]

export default async function FunnelPage({
  searchParams,
}: {
  searchParams: { range?: string }
}) {
  const data = await getJourneyData(searchParams)
  const rangeLabel = RANGE_LABELS[searchParams?.range ?? '30d'] ?? 'Last 30 Days'

  const notLive: string[] = []
  if (!data.webSourced) notLive.push('Web acquisition (Short.io not synced for this range)')
  if (!data.appSourced) notLive.push('App engagement (no Firebase app events for this range)')

  const appBarData: BarChartDataPoint[] = data.milestones.map((m) => ({ label: m.label, value: m.users }))

  const milestoneRows = data.milestones.map((m) => ({
    milestone: m.label,
    users: formatNumber(m.users),
    events: formatNumber(m.count),
    basis: m.basis,
  }))

  const attributionBar: BarChartDataPoint[] = data.attribution.map((a) => ({ label: a.platform, value: a.clicks }))

  return (
    <div>
      <Header title="User Journey" />

      {/* Non-live sources are always disclosed — mock is never shown as live */}
      {notLive.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-800">Some sources are not live for this range</p>
          <ul className="mt-1 list-disc pl-5 text-xs text-amber-700">
            {notLive.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}

      {/* How to read this — the tracks are NOT one tracked cohort */}
      <div className="mb-6 rounded-lg border border-mrhb-blue-light bg-mrhb-blue-light/30 p-4">
        <p className="text-sm font-medium text-mrhb-dark">How to read this</p>
        <p className="mt-1 text-xs text-mrhb-dark/70">
          This is a cross-source journey, <strong>not a single tracked cohort</strong>. Web acquisition
          (Short.io + GA4 web) and app engagement (Firebase, all platforms) are measured independently over{' '}
          {rangeLabel.toLowerCase()}. App milestones reflect the <strong>whole active user base&apos;s</strong>{' '}
          events in the period — not only users who installed in this window — so later milestones can exceed
          installs. &ldquo;Active Users&rdquo; is GA4&apos;s per-event user metric summed over days (a ceiling,
          not a unique-in-period count); &ldquo;Events&rdquo; is the raw event count.
        </p>
      </div>

      {/* Track A — Web acquisition */}
      <h2 className="mb-3 text-lg font-semibold text-mrhb-dark">
        Web Acquisition <span className="text-xs font-normal text-mrhb-dark/40">&middot; {rangeLabel}</span>
      </h2>
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KPICard
          title="Social Link Clicks"
          value={formatNumber(data.socialClicksTotal)}
          iconName="mouse-pointer-click"
          tooltip="Total clicks on Short.io social links for this range — authoritative per-range figure (matches the Social page)"
        />
        <KPICard
          title="Social Clicks (Human)"
          value={formatNumber(data.socialClicksHuman)}
          iconName="users"
          tooltip="Real-person clicks (bots excluded) on Short.io social links, per Short.io's own split"
        />
        <KPICard
          title="Social + Referral Sessions"
          value={formatNumber(data.socialReferralSessions)}
          iconName="share2"
          tooltip="GA4 website sessions in the 'Organic Social' + 'Referral' channels for this range"
        />
      </div>

      {/* Track B — App engagement */}
      <h2 className="mb-1 text-lg font-semibold text-mrhb-dark">
        App Engagement <span className="text-xs font-normal text-mrhb-dark/40">&middot; Firebase, all platforms &middot; {rangeLabel}</span>
      </h2>
      <p className="mb-4 text-xs text-mrhb-dark/50">
        Milestones across the active user base — shown side by side, not as sequential conversions.
      </p>
      <div className="mb-6">
        <BarChart
          data={appBarData}
          title="Active Users by App Milestone"
          color="#01A6FA"
          valueLabel="Active Users"
          height={360}
          layout="horizontal"
        />
      </div>
      <div className="mb-8">
        <DataTable
          columns={milestoneColumns}
          data={milestoneRows}
          title="App Milestones — Users, Events & Source"
          emptyMessage="No Firebase app events for this period."
        />
      </div>

      {/* Attribution */}
      <h2 className="mb-1 text-lg font-semibold text-mrhb-dark">
        Social Attribution <span className="text-xs font-normal text-mrhb-dark/40">&middot; {rangeLabel}</span>
      </h2>
      <p className="mb-4 text-sm text-mrhb-dark/60">
        Short.io link clicks by platform (reliable). GA4 social sessions are shown only as an aggregate:
        Google reports these under a generic &ldquo;social&rdquo; source, so a trustworthy per-platform GA4
        breakdown isn&apos;t available.
      </p>
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
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
        <div className="flex">
          <div className="w-full">
            <KPICard
              title="GA4 Social Sessions (aggregate)"
              value={formatNumber(data.ga4SocialSessions)}
              iconName="share2"
              tooltip="All GA4 website sessions in the 'Organic Social' channel for this range. Not broken out per platform because GA4's source for these is the generic 'social'."
            />
          </div>
        </div>
      </div>
    </div>
  )
}
