/**
 * TEMPORARY read-only diagnostic for the User Journey rework. Computes the
 * PROPOSED journey aggregation (corrected, all-platform event rules + the
 * `users` metric) so the numbers can be verified before porting the logic
 * into funnel/page.tsx. Remove after the rework ships. No writes.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getDateWindow } from '@/lib/utils/date-range'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

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
    if (error) throw new Error(`${table}: ${error.message}`)
    const rows = (data ?? []) as Record<string, any>[]
    all.push(...rows)
    if (rows.length < PAGE) break
  }
  return all
}

function topBy(map: Record<string, number>, n: number): Array<{ key: string; value: number }> {
  return Object.keys(map)
    .map((k) => ({ key: k, value: map[k] }))
    .sort((a, b) => b.value - a.value)
    .slice(0, n)
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const range = url.searchParams.get('range') ?? '30d'
  const supabase = createServiceClient()
  const { startDate: since, endDate: until } = getDateWindow({ range })
  const out: any = { ok: true, range, since, until }

  try {
    // ---- ga_events (with users) ----
    const events = await fetchAll(supabase, 'ga_events', 'date, event_name, event_count, users', since, until)

    // ---- Proposed journey milestones (corrected, all-platform rules) ----
    const mk = () => ({ count: 0, users: 0, matched: {} as Record<string, number> })
    const J = {
      installs: mk(),
      getStarted: mk(),
      onboardingStarted: mk(),
      onboardingComplete: mk(),
      dashboard: mk(),
      transaction: mk(),
      returning: mk(),
    }
    const add = (b: { count: number; users: number; matched: Record<string, number> }, name: string, c: number, u: number) => {
      b.count += c
      b.users += u
      b.matched[name] = (b.matched[name] ?? 0) + c
    }
    for (const r of events) {
      const raw = String(r.event_name ?? '')
      const n = raw.toUpperCase()
      const c = Number(r.event_count) || 0
      const u = Number(r.users) || 0
      if (n === 'FIRST_OPEN') add(J.installs, raw, c, u)
      if (n.includes('GET_STARTED')) add(J.getStarted, raw, c, u)
      if (n.includes('ONBOARDING_LETS_GO')) add(J.onboardingStarted, raw, c, u)
      if (n.includes('ONBOARDING_GUIDE_COMPLETE')) add(J.onboardingComplete, raw, c, u)
      if (n.includes('APP_DASHBOARD')) add(J.dashboard, raw, c, u)
      if (n.includes('SEND_MONEY') || n.includes('_SEND_') || n.includes('SWAP') || n.includes('SAHAL_RAMP'))
        add(J.transaction, raw, c, u)
      if (n === 'SESSION_START') add(J.returning, raw, c, u)
    }
    const summarize = (b: { count: number; users: number; matched: Record<string, number> }) => ({
      count: b.count,
      users: b.users,
      topMatched: topBy(b.matched, 8),
    })
    out.journey_appTrack = {
      installs: summarize(J.installs),
      getStarted: summarize(J.getStarted),
      onboardingStarted: summarize(J.onboardingStarted),
      onboardingComplete: summarize(J.onboardingComplete),
      dashboard: summarize(J.dashboard),
      transaction: summarize(J.transaction),
      returning: summarize(J.returning),
    }

    // ---- Track A: web acquisition ----
    const shortioRange = await supabase
      .from('shortio_clicks')
      .select('total_clicks, human_clicks')
      .eq('link_id', `range_${range}`)
      .order('date', { ascending: false })
      .limit(1)
    const socialSessions = await supabase
      .from('ga_traffic')
      .select('sessions')
      .gte('date', since)
      .lte('date', until)
      .in('channel', ['Organic Social', 'Referral'])
    out.journey_webTrack = {
      shortioRange: shortioRange.data?.[0] ?? null,
      socialReferralSessions: (socialSessions.data ?? []).reduce((s: number, r: any) => s + (Number(r.sessions) || 0), 0),
    }

    // ---- Attribution: Short.io per-platform clicks + aggregate GA4 social ----
    const bySocial = await supabase
      .from('shortio_clicks')
      .select('date, link_id, referrer, total_clicks, human_clicks')
      .in('link_id', [`by_social_${range}`, 'by_social'])
      .order('date', { ascending: false })
    const socRows = (bySocial.data ?? []) as any[]
    const latest = socRows.reduce((m, r) => (String(r.date) > m ? String(r.date) : m), '')
    const scoped = socRows.filter((r) => String(r.date) === latest)
    const gaSocialAgg = await supabase
      .from('ga_traffic')
      .select('sessions')
      .gte('date', since)
      .lte('date', until)
      .eq('channel', 'Organic Social')
    out.attribution = {
      shortioByPlatform: scoped.map((r) => ({ referrer: r.referrer, total: r.total_clicks, human: r.human_clicks })),
      ga4SocialSessionsAggregate: (gaSocialAgg.data ?? []).reduce((s: number, r: any) => s + (Number(r.sessions) || 0), 0),
    }

    return NextResponse.json(out)
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e), partial: out }, { status: 200 })
  }
}
