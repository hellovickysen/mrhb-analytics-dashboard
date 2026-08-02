/**
 * In-app tool → GA4 event-name mapping + aggregation helpers, used by the App
 * Performance "Tool Usage" section and the Admin mapping editor.
 *
 * Patterns are UPPERCASE substrings matched against ga_events.event_name
 * across all platform prefixes (SA_/SI_/SW_ screens, EA_/EI_/EW_ actions, and
 * the SCREEN__/EVENT__ variants). Assignment is FIRST-MATCH-WINS by sortOrder
 * so an event is only ever counted under one tool (avoids double-counting when
 * one screen mentions two tools, e.g. an eSIM package inside the store).
 *
 * Defaults were derived from a 90-day discovery of the real event taxonomy.
 * They're the fallback when the `tool_usage_config` table is absent/empty; the
 * Admin panel can override them without a deploy.
 */

export interface ToolMapping {
  tool: string
  patterns: string[]
  sortOrder: number
  isActive: boolean
}

export const DEFAULT_TOOL_MAPPINGS: ToolMapping[] = [
  { tool: 'MIRO', patterns: ['MIRO'], sortOrder: 1, isActive: true },
  { tool: 'Halalytix', patterns: ['HALALYTIX'], sortOrder: 2, isActive: true },
  { tool: 'EMPLIFAI', patterns: ['EMPLIFAI'], sortOrder: 3, isActive: true },
  { tool: 'Sahal Give', patterns: ['SAHAL_GIVE'], sortOrder: 4, isActive: true },
  { tool: 'MRHB Store', patterns: ['MRHB_STORE', 'APPS_STORE'], sortOrder: 5, isActive: true },
  { tool: 'Sahal Stake', patterns: ['SAHAL_STAKE'], sortOrder: 6, isActive: true },
  { tool: 'eSIM', patterns: ['ESIM'], sortOrder: 7, isActive: true },
  { tool: 'TijarX', patterns: ['TIJARX'], sortOrder: 8, isActive: true },
  { tool: 'Zakat Calculator', patterns: ['ZAKAT'], sortOrder: 9, isActive: true },
]

export type Platform = 'android' | 'ios' | 'web' | 'other'

export function platformOf(nameUpper: string): Platform {
  if (nameUpper.startsWith('SA_') || nameUpper.startsWith('EA_') || nameUpper.indexOf('__ANDROID') !== -1) return 'android'
  if (nameUpper.startsWith('SI_') || nameUpper.startsWith('EI_') || nameUpper.indexOf('__IOS') !== -1) return 'ios'
  if (nameUpper.startsWith('SW_') || nameUpper.startsWith('EW_') || nameUpper.indexOf('__WEB') !== -1) return 'web'
  return 'other'
}

export interface ToolEventRow {
  date?: string
  event_name: string
  event_count: number
  users: number
}

export interface ToolStat {
  tool: string
  users: number
  events: number
  android: number
  ios: number
  web: number
}

/** Returns active mappings sorted by sortOrder (ascending). */
function activeSorted(mappings: ToolMapping[]): ToolMapping[] {
  return mappings.filter((m) => m.isActive && m.patterns.length > 0).slice().sort((a, b) => a.sortOrder - b.sortOrder)
}

/** First tool (by order) whose any pattern is a substring of the uppercased name. */
function matchTool(nameUpper: string, sorted: ToolMapping[]): ToolMapping | null {
  for (const m of sorted) {
    for (const p of m.patterns) {
      const pat = p.toUpperCase().trim()
      if (pat && nameUpper.indexOf(pat) !== -1) return m
    }
  }
  return null
}

/** Aggregates per-tool users/events + platform split (first-match-wins). */
export function computeToolStats(events: ToolEventRow[], mappings: ToolMapping[]): ToolStat[] {
  const sorted = activeSorted(mappings)
  const acc = new Map<string, ToolStat>()
  for (const m of sorted) acc.set(m.tool, { tool: m.tool, users: 0, events: 0, android: 0, ios: 0, web: 0 })

  for (const e of events) {
    const nameUpper = String(e.event_name ?? '').toUpperCase()
    const m = matchTool(nameUpper, sorted)
    if (!m) continue
    const s = acc.get(m.tool)
    if (!s) continue
    const c = Number(e.event_count) || 0
    const u = Number(e.users) || 0
    s.events += c
    s.users += u
    const plat = platformOf(nameUpper)
    if (plat === 'android') s.android += u
    else if (plat === 'ios') s.ios += u
    else if (plat === 'web') s.web += u
  }

  return Array.from(acc.values()).sort((a, b) => b.users - a.users)
}

export interface ToolTab {
  tool: string
  users: number
  events: number
  android: number
  ios: number
  web: number
  trend: Array<{ date: string; users: number; events: number }>
}

/** Per-tool stats + a per-DATE trend over the window (first-match-wins). */
export function computeToolTabs(events: ToolEventRow[], mappings: ToolMapping[]): ToolTab[] {
  const sorted = activeSorted(mappings)
  const acc = new Map<
    string,
    { users: number; events: number; android: number; ios: number; web: number; byDate: Map<string, { users: number; events: number }> }
  >()
  for (const m of sorted) acc.set(m.tool, { users: 0, events: 0, android: 0, ios: 0, web: 0, byDate: new Map() })

  for (const e of events) {
    const nameUpper = String(e.event_name ?? '').toUpperCase()
    const m = matchTool(nameUpper, sorted)
    if (!m) continue
    const s = acc.get(m.tool)
    if (!s) continue
    const c = Number(e.event_count) || 0
    const u = Number(e.users) || 0
    s.events += c
    s.users += u
    const plat = platformOf(nameUpper)
    if (plat === 'android') s.android += u
    else if (plat === 'ios') s.ios += u
    else if (plat === 'web') s.web += u
    if (e.date) {
      const d = s.byDate.get(e.date) ?? { users: 0, events: 0 }
      d.users += u
      d.events += c
      s.byDate.set(e.date, d)
    }
  }

  return sorted
    .map((m) => {
      const s = acc.get(m.tool) as NonNullable<ReturnType<typeof acc.get>>
      const trend = Array.from(s.byDate.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, v]) => ({ date, users: v.users, events: v.events }))
      return { tool: m.tool, users: s.users, events: s.events, android: s.android, ios: s.ios, web: s.web, trend }
    })
    .sort((a, b) => b.users - a.users)
}

/** Daily total tool engagement (events + users) across all mapped tools. */
export function computeToolTrend(events: ToolEventRow[], mappings: ToolMapping[]): Array<{ date: string; events: number; users: number }> {
  const sorted = activeSorted(mappings)
  const byDate = new Map<string, { events: number; users: number }>()
  for (const e of events) {
    if (!e.date) continue
    const nameUpper = String(e.event_name ?? '').toUpperCase()
    if (!matchTool(nameUpper, sorted)) continue
    const d = byDate.get(e.date) ?? { events: 0, users: 0 }
    d.events += Number(e.event_count) || 0
    d.users += Number(e.users) || 0
    byDate.set(e.date, d)
  }
  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, events: v.events, users: v.users }))
}
