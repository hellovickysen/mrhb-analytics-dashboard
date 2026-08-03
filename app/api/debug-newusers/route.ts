/**
 * TEMPORARY read-only diagnostic. Given the Firebase events taxonomy, evaluates
 * candidate "new user / signup" signals so we can pick the best proxy to replace
 * first_open. No writes. Remove after wiring the New Users metric.
 *
 * From the taxonomy PDF: every NEW-USER onboarding flow (Let's Go, Social
 * Signup, Import Wallet seed/private-key/backup) passes through the
 * create-a-passcode screen SETTINGS_NEW_PASSCODE, while RETURNING users only
 * enter an existing passcode. So SETTINGS_NEW_PASSCODE users ≈ genuine new
 * signups, and should track the backend "New Users" figure far better than
 * first_open.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getDateWindow } from '@/lib/utils/date-range'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function fetchAll(
  supabase: ReturnType<typeof createServiceClient>,
  since: string,
  until: string
): Promise<Record<string, any>[]> {
  const all: Record<string, any>[] = []
  const PAGE = 1000
  for (let p = 0; p < 60; p++) {
    const { data, error } = await supabase
      .from('ga_events')
      .select('date, event_name, event_count, users')
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

export async function GET(request: Request) {
  const url = new URL(request.url)
  const range = url.searchParams.get('range') ?? '30d'
  const supabase = createServiceClient()
  const { startDate: since, endDate: until } = getDateWindow({ range })

  try {
    const events = await fetchAll(supabase, since, until)
    const U = (r: any) => String(r.event_name ?? '').toUpperCase()
    const sumUsers = (pred: (n: string) => boolean) =>
      events.filter((r) => pred(U(r))).reduce((s, r) => s + (Number(r.users) || 0), 0)
    const sumCount = (pred: (n: string) => boolean) =>
      events.filter((r) => pred(U(r))).reduce((s, r) => s + (Number(r.event_count) || 0), 0)
    // Distinct matching event names, so we can see exactly what fires.
    const names = (pred: (n: string) => boolean) =>
      Array.from(new Set(events.filter((r) => pred(U(r))).map((r) => String(r.event_name)))).sort()

    const candidates: Record<string, any> = {}
    const add = (key: string, pred: (n: string) => boolean) => {
      candidates[key] = { users_summed_daily: sumUsers(pred), event_count: sumCount(pred), names: names(pred) }
    }

    add('first_open', (n) => n === 'FIRST_OPEN')
    add('settings_new_passcode', (n) => n.includes('SETTINGS_NEW_PASSCODE'))
    add('onboarding_lets_go', (n) => n.includes('ONBOARDING_LETS_GO'))
    add('onboarding_social_signup', (n) => n.includes('ONBOARDING_SOCIAL_SIGNUP'))
    add('onboarding_import_wallet', (n) => n.includes('ONBOARDING_IMPORT_WALLET'))
    add('onboarding_guide_complete', (n) => n.includes('ONBOARDING_GUIDE_COMPLETE'))
    add('get_started', (n) => n.includes('GET_STARTED'))
    // Union of the "new user entry" signals (any onboarding entry OR new passcode)
    add('new_user_union', (n) =>
      n.includes('SETTINGS_NEW_PASSCODE') ||
      n.includes('ONBOARDING_LETS_GO') ||
      n.includes('ONBOARDING_SOCIAL_SIGNUP') ||
      n.includes('ONBOARDING_IMPORT_WALLET')
    )

    return NextResponse.json({ ok: true, range, since, until, totalRows: events.length, candidates })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 200 })
  }
}
