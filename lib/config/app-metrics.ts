/**
 * App Performance metric → GA4 event mapping (admin-editable "event → card").
 *
 * The App Performance KPIs, onboarding funnel, and trend are all built from a
 * few named "metric blocks", each defined by event-name patterns matched
 * against ga_events.event_name (all platforms). Editing a block's patterns in
 * Admin changes every card derived from it — so App Performance stays honest to
 * the actual Firebase events the wallet fires.
 *
 * These defaults are the fallback when the `app_metric_map` table is absent
 * (migration 004 not applied yet). Derived from a 90-day event-taxonomy scan.
 */

export type MatchType = 'exact' | 'contains'

export interface AppMetricDef {
  key: string
  label: string
  patterns: string[]
  matchType: MatchType
  description: string
  usedBy: string
  sortOrder: number
  isActive: boolean
}

export const DEFAULT_APP_METRICS: AppMetricDef[] = [
  {
    key: 'first_open',
    label: 'App Opens (installs proxy)',
    patterns: ['FIRST_OPEN'],
    matchType: 'exact',
    description: "Firebase's first_open — fires once per device on first launch after install.",
    usedBy: 'Total Installs (proxy), Onboarding Rate (÷ denominator), Funnel: App Opened, Installs trend',
    sortOrder: 1,
    isActive: true,
  },
  {
    key: 'session_start',
    label: 'App Sessions',
    patterns: ['SESSION_START'],
    matchType: 'exact',
    description: 'Firebase session_start — an app session began.',
    usedBy: 'Active Users (fallback when GA4 app metric unavailable), Active-users trend',
    sortOrder: 2,
    isActive: true,
  },
  {
    key: 'get_started',
    label: 'Get Started',
    patterns: ['GET_STARTED'],
    matchType: 'contains',
    description: 'Any Get Started screen (SA_/SI_/SW_..._GET_STARTED), all platforms.',
    usedBy: 'Funnel: Get Started',
    sortOrder: 3,
    isActive: true,
  },
  {
    key: 'onboarding_complete',
    label: 'Onboarding Complete',
    patterns: ['ONBOARDING_GUIDE_COMPLETE'],
    matchType: 'contains',
    description: 'Guided-onboarding completion event (EA_/EI_/EW_ONBOARDING_GUIDE_COMPLETE).',
    usedBy: 'Onboarding Rate (numerator), Funnel: Onboarding Complete',
    sortOrder: 4,
    isActive: true,
  },
  {
    key: 'dashboard',
    label: 'Dashboard Reached',
    patterns: ['APP_DASHBOARD'],
    matchType: 'contains',
    description: 'Main app dashboard screen reached (S*_APP_DASHBOARD / SCREEN__*__APP_DASHBOARD).',
    usedBy: 'Transaction Rate (÷ denominator), Funnel: Reached Dashboard',
    sortOrder: 5,
    isActive: true,
  },
  {
    key: 'transaction',
    label: 'Transactions',
    patterns: ['SEND_MONEY', '_SEND_', 'SWAP', 'SAHAL_RAMP'],
    matchType: 'contains',
    description: 'Send / swap / ramp transaction events across platforms.',
    usedBy: 'Transaction Rate (numerator), Funnel: Transaction',
    sortOrder: 6,
    isActive: true,
  },
]

/** True if an UPPERCASE event name matches the metric definition. */
export function matchesAppMetric(def: AppMetricDef, nameUpper: string): boolean {
  if (!def.isActive) return false
  if (def.matchType === 'exact') {
    return def.patterns.some((p) => nameUpper === p.toUpperCase().trim())
  }
  return def.patterns.some((p) => {
    const pat = p.toUpperCase().trim()
    return pat !== '' && nameUpper.indexOf(pat) !== -1
  })
}

/**
 * Merges DB config rows over the defaults, keyed by `key`. Rows may override
 * patterns / matchType / label / description / isActive for a known key, or add
 * new keys. Returns a Map for O(1) lookup by the page.
 */
export function resolveAppMetrics(
  rows?: Array<{ key?: string; label?: string; patterns?: string; match_type?: string; description?: string; used_by?: string; sort_order?: number; is_active?: boolean }> | null
): Map<string, AppMetricDef> {
  const map = new Map<string, AppMetricDef>()
  for (const d of DEFAULT_APP_METRICS) map.set(d.key, { ...d })

  for (const r of rows ?? []) {
    const key = String(r.key ?? '').trim()
    if (!key) continue
    const existing = map.get(key)
    const patterns = String(r.patterns ?? '')
      .split(',')
      .map((p) => p.trim().toUpperCase())
      .filter(Boolean)
    map.set(key, {
      key,
      label: r.label ?? existing?.label ?? key,
      patterns: patterns.length > 0 ? patterns : existing?.patterns ?? [],
      matchType: (r.match_type === 'exact' || r.match_type === 'contains' ? r.match_type : existing?.matchType ?? 'contains') as MatchType,
      description: r.description ?? existing?.description ?? '',
      usedBy: r.used_by ?? existing?.usedBy ?? '',
      sortOrder: Number(r.sort_order) || existing?.sortOrder || 0,
      isActive: r.is_active !== false,
    })
  }
  return map
}
