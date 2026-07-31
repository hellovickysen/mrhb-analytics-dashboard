/**
 * TEMPORARY read-only diagnostic for characterizing ga_traffic pollution.
 * Remove after the cleanup is designed. Returns only aggregate counts — no
 * mutations. Gated by the app's existing auth (middleware).
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const maxDuration = 60

export async function GET() {
  const supabase = createServiceClient()

  // Pull a bounded slice for aggregation (JS-side, since PostgREST has no GROUP BY).
  const { data, error, count } = await supabase
    .from('ga_traffic')
    .select('date, channel, source, medium, campaign, sessions, users', { count: 'exact' })
    .order('date', { ascending: false })
    .limit(20000)

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  const rows = data ?? []
  const today = new Date().toISOString().slice(0, 10)
  const d30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)

  const campaignKey = (c: unknown) => (c === null ? '__NULL__' : c === '' ? '__EMPTY__' : String(c))

  // Distinct campaign values: rows + session sum (all fetched + last 30d).
  const byCampaign: Record<string, { rows: number; sessions: number; rows30: number; sessions30: number }> = {}
  // For campaign NULL in last 30d: top source/medium by sessions.
  const nullSrc30: Record<string, number> = {}
  // Duplicate detection on the full conflict key.
  const keyCounts = new Map<string, number>()
  let minDate = '9999'
  let maxDate = '0000'

  for (const r of rows as any[]) {
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
    totalRowCountExact: count,
    fetchedRows: rows.length,
    dateRange: { minDate, maxDate },
    byCampaign,
    duplicateFullKeys: dupes.length,
    duplicateSample: dupes.slice(0, 10).map(([k, n]) => ({ key: k, count: n })),
    last30_campaignNull_topSources: topNullSrc30,
  })
}
