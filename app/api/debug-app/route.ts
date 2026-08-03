/**
 * TEMPORARY read-only diagnostic for the App Performance rework. Reports the
 * contents of play_installs / play_ratings and the CURRENT (buggy) vs CORRECTED
 * app KPI values for the given range. Remove after the rework ships. No writes.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getDateWindow } from '@/lib/utils/date-range'
import { fetchGA4AppActiveUsersTotal } from '@/lib/api-clients/ga4-app-active-total'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function fetchAll(
  supabase: ReturnType<typeof createServiceClient>,
  table: string,
  columns: string,
  since: string,
  until: string
): Promise<Record<string, any>[]> {
  const all: Record<string, any>[] = []
  const PAGE = 1000
  for (let p = 0; p < 40; p++) {
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

export async function GET(request: Request) {
  const url = new URL(request.url)
  const range = url.searchParams.get('range') ?? '30d'
  const supabase = createServiceClient()
  const { startDate: since, endDate: until, prevStartDate } = getDateWindow({ range })
  const out: any = { ok: true, range, since, until }

  try {
    const events = await fetchAll(supabase, 'ga_events', 'date, event_name, event_count, users', since, until)
    const upper = (r: any) => String(r.event_name ?? '').toUpperCase()
    const sumCount = (pred: (n: string) => boolean) =>
      events.filter((r) => pred(upper(r))).reduce((s, r) => s + (Number(r.event_count) || 0), 0)
    const sumUsers = (pred: (n: string) => boolean) =>
      events.filter((r) => pred(upper(r))).reduce((s, r) => s + (Number(r.users) || 0), 0)

    out.eventKpis = {
      first_open_count: sumCount((n) => n === 'FIRST_OPEN'),
      session_start_count: sumCount((n) => n === 'SESSION_START'),
      session_start_users: sumUsers((n) => n === 'SESSION_START'),
      onboardingComplete_EW_only: sumCount((n) => n === 'EW_ONBOARDING_GUIDE_COMPLETE'),
      onboardingComplete_allPlatform: sumCount((n) => n.includes('ONBOARDING_GUIDE_COMPLETE')),
      onboardingComplete_users_allPlatform: sumUsers((n) => n.includes('ONBOARDING_GUIDE_COMPLETE')),
      getStarted_allPlatform_users: sumUsers((n) => n.includes('GET_STARTED')),
      dashboard_allPlatform_users: sumUsers((n) => n.includes('APP_DASHBOARD')),
      transactions_EA_SEND_prefix: sumCount((n) => n.startsWith('EA_SEND_')),
      transactions_corrected_count: sumCount(
        (n) => n.includes('SEND_MONEY') || n.includes('_SEND_') || n.includes('SWAP') || n.includes('SAHAL_RAMP')
      ),
      transactions_corrected_users: sumUsers(
        (n) => n.includes('SEND_MONEY') || n.includes('_SEND_') || n.includes('SWAP') || n.includes('SAHAL_RAMP')
      ),
      tileClicks_EA_T_count: sumCount((n) => n.startsWith('EA_T_')),
    }

    // Authoritative de-duplicated GA4 app active users (current + previous).
    const [activeCur, activePrev] = await Promise.all([
      fetchGA4AppActiveUsersTotal(since, until),
      fetchGA4AppActiveUsersTotal(prevStartDate, since),
    ])
    out.ga4AppActiveUsers = { current: activeCur, previous: activePrev }

    // Store tables.
    const [installsRes, ratingsRes] = await Promise.all([
      supabase.from('play_installs').select('date, installs, uninstalls, active_devices, country').order('date', { ascending: false }).limit(10),
      supabase.from('play_ratings').select('date, avg_rating, total_ratings, star_1, star_2, star_3, star_4, star_5, reviews_count').order('date', { ascending: false }).limit(5),
    ])
    out.play_installs = { error: installsRes.error?.message ?? null, rows: installsRes.data ?? [] }
    out.play_ratings = { error: ratingsRes.error?.message ?? null, rows: ratingsRes.data ?? [] }

    return NextResponse.json(out)
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e), partial: out }, { status: 200 })
  }
}
