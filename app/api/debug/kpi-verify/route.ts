import { NextResponse } from 'next/server'
import { google, type analyticsdata_v1beta } from 'googleapis'
import { createClient } from '@supabase/supabase-js'
import { getGoogleAuth } from '@/lib/api-clients/google-auth'
import { fetchGA4AppActiveUsersTotal } from '@/lib/api-clients/ga4-app-active-total'

// TEMPORARY read-only KPI audit route. Compares each App Performance card's
// current computation against the correct GA4 period-wide method, to confirm
// which cards are clean and quantify the double-count in the two rate cards.
// DELETE after reading.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function toNum(v: string | undefined | null): number {
  if (v === undefined || v === null || v === '') return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
function fmt(d: Date): string {
  return d.toISOString().slice(0, 10)
}

type Row = { date: string; event_name: string; event_count: number; users: number }

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const start = url.searchParams.get('start') || undefined
    const end = url.searchParams.get('end') || undefined
    const days = Math.min(120, Math.max(1, Number(url.searchParams.get('days')) || 30))
    const now = new Date()
    const startDate = start || fmt(new Date(now.getTime() - days * 86400000))
    const endDate = end || fmt(now)

    // ---- Supabase: replicate the cards' current ga_events-based math ----
    const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supaUrl || !supaKey) return NextResponse.json({ error: 'Missing Supabase config' })
    const supabase = createClient(supaUrl, supaKey)

    const rows: Row[] = []
    const PAGE = 1000
    for (let p = 0; p < 40; p++) {
      const { data, error } = await supabase
        .from('ga_events')
        .select('date, event_name, event_count, users')
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: true })
        .range(p * PAGE, p * PAGE + PAGE - 1)
      if (error) return NextResponse.json({ error: error.message })
      const batch = (data ?? []) as Row[]
      rows.push.apply(rows, batch)
      if (batch.length < PAGE) break
    }
    const U = (r: Row): string => String(r.event_name ?? '').toUpperCase()
    const sumCount = (pred: (n: string) => boolean): number =>
      rows.filter((r: Row) => pred(U(r))).reduce((s: number, r: Row) => s + (Number(r.event_count) || 0), 0)
    const sumUsers = (pred: (n: string) => boolean): number =>
      rows.filter((r: Row) => pred(U(r))).reduce((s: number, r: Row) => s + (Number(r.users) || 0), 0)

    const firstOpenCount = sumCount((n) => n === 'FIRST_OPEN')
    const completeUsersSum = sumUsers((n) => n.includes('ONBOARDING_GUIDE_COMPLETE'))
    const dashboardUsersSum = sumUsers((n) => n.includes('APP_DASHBOARD'))
    const txUsersSum = sumUsers(
      (n) => n.includes('SEND_MONEY') || n.includes('_SEND_') || n.includes('SWAP') || n.includes('SAHAL_RAMP')
    )

    // ---- GA4: correct period-wide de-duplicated uniques ----
    const auth = getGoogleAuth()
    const propertyId = process.env.GA4_APP_PROPERTY_ID
    if (!auth || !propertyId) return NextResponse.json({ error: 'Missing GA4 auth or GA4_APP_PROPERTY_ID' })
    const client: analyticsdata_v1beta.Analyticsdata = google.analyticsdata({ version: 'v1beta', auth })
    const property = `properties/${propertyId}`

    const periodUnique = async (regex: string): Promise<number> => {
      const resp = await client.properties.runReport({
        property,
        requestBody: {
          dateRanges: [{ startDate, endDate }],
          metrics: [{ name: 'activeUsers' }],
          dimensionFilter: {
            filter: {
              fieldName: 'eventName',
              stringFilter: { matchType: 'PARTIAL_REGEXP', value: regex, caseSensitive: false },
            },
          },
        },
      })
      return toNum(resp.data.rows?.[0]?.metricValues?.[0]?.value)
    }

    const activeUsers = await fetchGA4AppActiveUsersTotal(startDate, endDate)
    const [completeAll, completeAI, dashAll, dashAI, txAll, txAI, firstOpenUsersAll, firstOpenUsersAI] =
      await Promise.all([
        periodUnique('ONBOARDING_GUIDE_COMPLETE'),
        periodUnique('^[ES][AI]_.*ONBOARDING_GUIDE_COMPLETE'),
        periodUnique('APP_DASHBOARD'),
        periodUnique('^[ES][AI]_.*APP_DASHBOARD'),
        periodUnique('(SEND_MONEY|_SEND_|SWAP|SAHAL_RAMP)'),
        periodUnique('^[ES][AI]_.*(SEND_MONEY|_SEND_|SWAP|SAHAL_RAMP)'),
        periodUnique('FIRST_OPEN'),
        periodUnique('^[ES][AI]_.*FIRST_OPEN'),
      ])

    const pct = (num: number, den: number): number => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0)

    return NextResponse.json({
      window: { startDate, endDate },
      activeUsers_card_GA4periodWide: activeUsers,
      current_gaEventsSum: {
        firstOpenCount,
        completeUsersSum,
        dashboardUsersSum,
        txUsersSum,
        onboardingRate_pct: pct(completeUsersSum, firstOpenCount),
        transactionRate_pct: pct(txUsersSum, dashboardUsersSum),
      },
      correct_GA4periodWide: {
        firstOpenUsers_all: firstOpenUsersAll,
        firstOpenUsers_androidIos: firstOpenUsersAI,
        complete_all: completeAll,
        complete_androidIos: completeAI,
        dashboard_all: dashAll,
        dashboard_androidIos: dashAI,
        tx_all: txAll,
        tx_androidIos: txAI,
        onboardingRate_androidIos_pct: pct(completeAI, firstOpenUsersAI),
        transactionRate_androidIos_pct: pct(txAI, dashAI),
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? String(err) })
  }
}
