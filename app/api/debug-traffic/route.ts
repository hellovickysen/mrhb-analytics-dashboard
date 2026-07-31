/**
 * TEMPORARY read + one-time cleanup helper for ga_traffic. Remove after use.
 *
 *   GET  /api/debug-traffic            -> aggregate diagnostics (campaign dist,
 *                                         duplicate-key detection, top sources)
 *   GET  /api/debug-traffic?dump=1     -> ALL rows (paginated), for backup
 *   POST /api/debug-traffic            -> body { action:'delete-all',
 *                                         confirm:'YES_DELETE_GA_TRAFFIC' }
 *                                         deletes every ga_traffic row.
 *
 * Read paths are safe; the POST is destructive and requires the exact confirm
 * token. Gated by the app's existing auth (middleware).
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const maxDuration = 120

async function fetchAllRows(supabase: ReturnType<typeof createServiceClient>) {
  const all: any[] = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('ga_traffic')
      .select('date, channel, source, medium, campaign, sessions, users, new_users, bounce_rate, avg_session_duration')
      .order('date', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const rows = data ?? []
    all.push(...rows)
    if (rows.length < PAGE) break
  }
  return all
}

export async function GET(request: Request) {
  const supabase = createServiceClient()
  const url = new URL(request.url)

  if (url.searchParams.get('dump') === '1') {
    try {
      const rows = await fetchAllRows(supabase)
      return NextResponse.json({ ok: true, count: rows.length, rows })
    } catch (e) {
      return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 })
    }
  }

  let rows: any[]
  try {
    rows = await fetchAllRows(supabase)
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }

  const today = new Date().toISOString().slice(0, 10)
  const d30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
  const campaignKey = (c: unknown) => (c === null ? '__NULL__' : c === '' ? '__EMPTY__' : String(c))

  const byCampaign: Record<string, { rows: number; sessions: number; rows30: number; sessions30: number }> = {}
  const nullSrc30: Record<string, number> = {}
  const keyCounts = new Map<string, number>()
  let minDate = '9999'
  let maxDate = '0000'

  for (const r of rows) {
    if (r.date < minDate) minDate = r.date
    if (r.date > maxDate) maxDate = r.date
    const ck = campaignKey(r.campaign)
    const b = (byCampaign[ck] ??= { rows: 0, sessions: 0, rows30: 0, sessions30: 0 })
    b.rows += 1
    b.sessions += r.sessions ?? 0
    const in30 = r.date >= d30 && r.date <= today
    if (in30) {
      b.rows30 += 1
      b.sessions30 += r.sessions ?? 0
      if (r.campaign === null) {
        const k = `${r.source} / ${r.medium}`
        nullSrc30[k] = (nullSrc30[k] ?? 0) + (r.sessions ?? 0)
      }
    }
    const fullKey = `${r.date}|${r.channel}|${r.source}|${r.medium}|${ck}`
    keyCounts.set(fullKey, (keyCounts.get(fullKey) ?? 0) + 1)
  }

  const dupes = Array.from(keyCounts.entries()).filter(([, n]) => n > 1)
  const topNullSrc30 = Object.entries(nullSrc30)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([sourceMedium, sessions]) => ({ sourceMedium, sessions }))

  return NextResponse.json({
    ok: true,
    totalRowCount: rows.length,
    dateRange: { minDate, maxDate },
    byCampaign,
    duplicateKeys: dupes.length,
    duplicateSample: dupes.slice(0, 10).map(([k, n]) => ({ key: k, count: n })),
    last30_campaignNull_topSources: topNullSrc30,
  })
}

export async function POST(request: Request) {
  let body: { action?: string; confirm?: string } = {}
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 })
  }

  if (body.action !== 'delete-all' || body.confirm !== 'YES_DELETE_GA_TRAFFIC') {
    return NextResponse.json({ ok: false, error: 'requires { action:"delete-all", confirm:"YES_DELETE_GA_TRAFFIC" }' }, { status: 400 })
  }

  const supabase = createServiceClient()
  // Count first (for the response), then delete every row.
  const { count: before } = await supabase
    .from('ga_traffic')
    .select('*', { count: 'exact', head: true })

  const { error } = await supabase.from('ga_traffic').delete().gte('date', '1900-01-01')
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  const { count: after } = await supabase
    .from('ga_traffic')
    .select('*', { count: 'exact', head: true })

  return NextResponse.json({ ok: true, deletedApprox: before ?? null, remaining: after ?? null })
}
