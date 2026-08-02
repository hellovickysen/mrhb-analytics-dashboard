/** TEMPORARY: discover event names for 4 new tools. Remove after mapping. */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getDateWindow } from '@/lib/utils/date-range'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CAND: Record<string, string[]> = {
  Coinformance: ['COINFORMANCE', 'COIN_FORMANCE', 'COINFORM', 'KOINFORMANCE', 'INFORMANCE'],
  'Sahal Ramp': ['SAHAL_RAMP', 'RAMP'],
  'The Life DAO': ['LIFE_DAO', 'LIFEDAO', 'THE_LIFE', 'LIFE_D', 'THELIFE'],
  'The Muslim Traveller': ['MUSLIM_TRAVELLER', 'MUSLIM_TRAVELER', 'TRAVELLER', 'TRAVELER', 'MUSLIM'],
}

export async function GET() {
  const supabase = createServiceClient()
  const { startDate: since, endDate: until } = getDateWindow({ range: '90d' })
  const out: any = { ok: true, since, until }
  try {
    const all: any[] = []
    const PAGE = 1000
    for (let p = 0; p < 60; p++) {
      const { data, error } = await supabase
        .from('ga_events')
        .select('event_name, event_count, users')
        .gte('date', since)
        .lte('date', until)
        .range(p * PAGE, p * PAGE + PAGE - 1)
      if (error) throw new Error(error.message)
      const rows = data ?? []
      all.push(...rows)
      if (rows.length < PAGE) break
    }
    const agg: Record<string, { c: number; u: number }> = {}
    for (const r of all) {
      const n = String(r.event_name ?? '')
      const e = agg[n] ?? { c: 0, u: 0 }
      e.c += Number(r.event_count) || 0
      e.u += Number(r.users) || 0
      agg[n] = e
    }
    const names = Object.keys(agg)
    const per: Record<string, any> = {}
    for (const tool of Object.keys(CAND)) {
      const subs = CAND[tool]
      const matched = names
        .filter((n) => { const up = n.toUpperCase(); return subs.some((s) => up.indexOf(s) !== -1) })
        .map((n) => ({ name: n, c: agg[n].c, u: agg[n].u }))
        .sort((a, b) => b.c - a.c)
      per[tool] = { matched: matched.length, events: matched.reduce((s, m) => s + m.c, 0), users: matched.reduce((s, m) => s + m.u, 0), names: matched.slice(0, 25).map((m) => `${m.name} (c=${m.c},u=${m.u})`) }
    }
    out.tools = per
    return NextResponse.json(out)
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 200 })
  }
}
