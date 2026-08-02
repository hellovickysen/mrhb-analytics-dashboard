/**
 * TEMPORARY read-only diagnostic: enumerate ga_events event_names (90d) with
 * counts + users, and surface candidate matches for each of the 9 in-app tools
 * so we can build a precise, all-platform tool->event mapping. Remove after
 * the mapping is finalized. No writes.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getDateWindow } from '@/lib/utils/date-range'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Candidate substrings per tool (uppercased). Deliberately broad so we can see
// everything that *might* belong to a tool, then tighten later.
const TOOL_CANDIDATES: Record<string, string[]> = {
  EMPLIFAI: ['EMPLIFAI', 'AMPLIFAI', 'AMPLIFY', 'EMPLIFY'],
  MIRO: ['MIRO'],
  TijarX: ['TIJARX', 'TIJAR'],
  'Sahal Stake': ['STAKE', 'STAKING'],
  eSIM: ['ESIM', 'E_SIM', '_SIM_', 'SIM_'],
  'Sahal Give': ['GIVE', 'SADAQAH', 'DONAT', 'CHARITY'],
  Halalytix: ['HALALYTIX', 'HALALYTIC', 'HALALYT'],
  'MRHB Store': ['MRHB_STORE', 'MRHBSTORE', 'MRHB STORE', 'STORE'],
  'Zakat Calculator': ['ZAKAT'],
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const range = url.searchParams.get('range') ?? '90d'
  const supabase = createServiceClient()
  const { startDate: since, endDate: until } = getDateWindow({ range })
  const out: any = { ok: true, range, since, until }

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

    const agg: Record<string, { count: number; users: number }> = {}
    for (const r of all) {
      const n = String(r.event_name ?? '')
      const e = agg[n] ?? { count: 0, users: 0 }
      e.count += Number(r.event_count) || 0
      e.users += Number(r.users) || 0
      agg[n] = e
    }
    const names = Object.keys(agg)
    out.rowCount = all.length
    out.distinctEventNames = names.length

    const entries = names.map((n) => ({ name: n, count: agg[n].count, users: agg[n].users }))
    entries.sort((a, b) => b.count - a.count)
    out.top = entries.slice(0, 250)

    // Per-tool candidate matches (any candidate substring, case-insensitive).
    const perTool: Record<string, any> = {}
    for (const tool of Object.keys(TOOL_CANDIDATES)) {
      const subs = TOOL_CANDIDATES[tool]
      const matched = entries.filter((e) => {
        const up = e.name.toUpperCase()
        return subs.some((s) => up.indexOf(s) !== -1)
      })
      perTool[tool] = {
        matchedCount: matched.length,
        totalEvents: matched.reduce((s, m) => s + m.count, 0),
        totalUsers: matched.reduce((s, m) => s + m.users, 0),
        names: matched.slice(0, 25).map((m) => `${m.name} (c=${m.count}, u=${m.users})`),
      }
    }
    out.tools = perTool

    return NextResponse.json(out)
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e), partial: out }, { status: 200 })
  }
}
