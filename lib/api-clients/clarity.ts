/**
 * Microsoft Clarity API client.
 *
 * IMPORTANT — API limitations:
 * Microsoft Clarity does not (as of this writing) expose a full public REST
 * API for historical data export in the way GA4/GSC/Short.io do. The only
 * documented public endpoint is the "Data Export API"
 * (https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-data-export),
 * which:
 *   - Only returns a rolling last-3-days window (no arbitrary date-range
 *     backfill — `startDate`/`endDate` below are accepted for interface
 *     compatibility with the other clients but the API itself does not
 *     support ranging beyond the last 3 days).
 *   - Returns pre-aggregated metric summaries, not a raw dimension-level
 *     time series — the exact metric names/shape can change without notice.
 *   - Is rate-limited to a small number of requests per project per day.
 *
 * TODO(clarity): If the 3-day window / rate limit makes this endpoint
 * insufficient for the dashboard's historical reporting needs, fall back to
 * manual CSV export from the Clarity dashboard (Clarity project -> Export ->
 * Download CSV) and load it via a one-off import script instead of this
 * client. This module is written so that swap is transparent to callers:
 * both paths ultimately resolve to `ClaritySession[]` / `ClarityFriction[]`.
 *
 * Base URL:  https://www.clarity.ms/export-data/api/v1
 * Auth:      header `Authorization: Bearer <CLARITY_API_TOKEN>`
 *
 * Server-only. Do not import from a 'use client' component.
 *
 * Required env vars:
 *   - CLARITY_API_TOKEN
 *   - CLARITY_PROJECT_ID
 */

import type { ClaritySession, ClarityFriction } from '@/lib/types'

const CLARITY_BASE_URL = 'https://www.clarity.ms/export-data/api/v1'

/* ------------------------------------------------------------------------ */
/*  Raw Clarity API response shapes                                        */
/* ------------------------------------------------------------------------ */
/*  The Data Export API returns an array of metric groups, each with an     */
/*  `info` breakdown array. Shape below models the documented              */
/*  "project-live-insights" response closely enough to extract the metrics  */
/*  this client needs; treat all fields as best-effort/optional since       */
/*  Microsoft has changed this shape before without a version bump.         */

interface ClarityMetricInfo {
  [key: string]: string | number | undefined
}

interface ClarityMetricGroup {
  metricName?: string
  information?: ClarityMetricInfo[]
}

type ClarityApiResponse = ClarityMetricGroup[]

/* ------------------------------------------------------------------------ */
/*  Internal helpers                                                        */
/* ------------------------------------------------------------------------ */

interface ClarityConfig {
  token: string
  projectId: string
}

function getClarityConfig(): ClarityConfig | null {
  const token = process.env.CLARITY_API_TOKEN
  const projectId = process.env.CLARITY_PROJECT_ID

  if (!token || !projectId) {
    console.error(
      '[clarity] Missing CLARITY_API_TOKEN and/or CLARITY_PROJECT_ID env vars. ' +
        'Set both in .env.local (see .env.example) and in Vercel Environment Variables.'
    )
    return null
  }

  return { token, projectId }
}

function clarityHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  }
}

/** Formats a Date as YYYY-MM-DD. */
function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Today's date, formatted YYYY-MM-DD — used as the row date for the (rolling-window-only) API response. */
function today(): string {
  return toDateOnly(new Date())
}

/**
 * Fetches the raw Clarity Data Export API payload once. Both
 * `fetchClaritySessions` and `fetchClarityFriction` read different metrics
 * out of the same response, so this is shared rather than issuing two
 * separate HTTP calls against a rate-limited endpoint.
 *
 * `numOfDays` is Clarity's own query param name (1, 2, or 3 — the only
 * values the live API accepts as of this writing). Returns `null` on any
 * failure.
 */
async function fetchClarityExport(
  config: ClarityConfig,
  numOfDays: 1 | 2 | 3 = 3
): Promise<ClarityApiResponse | null> {
  try {
    const url = new URL(`${CLARITY_BASE_URL}/project-live-insights`)
    url.searchParams.set('numOfDays', String(numOfDays))

    const res = await fetch(url.toString(), { headers: clarityHeaders(config.token) })

    if (!res.ok) {
      console.error(
        `[clarity] GET /project-live-insights failed: ${res.status} ${res.statusText}. ` +
          'This endpoint only supports a rolling 1-3 day window; if you need historical ' +
          'backfill beyond that, use the manual CSV export fallback (see TODO(clarity) ' +
          'notes at the top of lib/api-clients/clarity.ts).'
      )
      return null
    }

    return (await res.json()) as ClarityApiResponse
  } catch (err) {
    console.error('[clarity] Error fetching Data Export API payload:', err)
    return null
  }
}

/** Case/spacing-insensitive lookup of a metric group by name. */
function findMetric(payload: ClarityApiResponse, metricName: string): ClarityMetricGroup | undefined {
  const normalized = metricName.toLowerCase().replace(/[\s_-]/g, '')
  return payload.find(
    (group) => (group.metricName ?? '').toLowerCase().replace(/[\s_-]/g, '') === normalized
  )
}

/** Sums a numeric field across every `information[]` entry of a metric group. */
function sumField(group: ClarityMetricGroup | undefined, field: string): number {
  if (!group?.information) return 0
  return group.information.reduce((total, entry) => {
    const value = entry[field]
    return total + (typeof value === 'number' ? value : Number(value) || 0)
  }, 0)
}

/** Averages a numeric field across every `information[]` entry of a metric group. */
function averageField(group: ClarityMetricGroup | undefined, field: string): number {
  if (!group?.information || group.information.length === 0) return 0
  const total = sumField(group, field)
  return total / group.information.length
}

/* ------------------------------------------------------------------------ */
/*  Public API                                                              */
/* ------------------------------------------------------------------------ */

/**
 * Fetches daily session-quality metrics: total sessions, bot sessions
 * excluded, pages per session, scroll depth, active time, and total time.
 *
 * `startDate` / `endDate` (YYYY-MM-DD) are accepted for interface parity
 * with the other API clients in this dashboard, but are NOT honored by the
 * live Clarity Data Export API, which only supports a rolling last-3-days
 * window with no arbitrary range selection. The date range you pass is
 * logged as a warning when it falls outside that window so callers notice
 * during development rather than silently getting an empty/short result.
 *
 * TODO(clarity): Swap this implementation for a CSV-import-based one if
 * historical backfill beyond 3 days is required — see module-level TODO.
 *
 * Returns `[]` on any failure or when required env vars are missing —
 * never throws.
 */
export async function fetchClaritySessions(
  startDate: string,
  endDate: string
): Promise<ClaritySession[]> {
  const config = getClarityConfig()
  if (!config) return []

  warnIfOutsideRollingWindow(startDate, endDate)

  const payload = await fetchClarityExport(config, 3)
  if (!payload) return []

  try {
    const sessionsGroup = findMetric(payload, 'Traffic')
    const botsGroup = findMetric(payload, 'BotTraffic') ?? findMetric(payload, 'Bot Sessions')
    const pagesGroup = findMetric(payload, 'PagesPerVisit') ?? findMetric(payload, 'PagesPerSession')
    const scrollGroup = findMetric(payload, 'ScrollDepth')
    const engagementGroup = findMetric(payload, 'EngagementTime') ?? findMetric(payload, 'ActiveTime')
    const totalTimeGroup = findMetric(payload, 'TotalTime') ?? findMetric(payload, 'TimeSpent')
    const popularPagesGroup = findMetric(payload, 'PopularPages')

    const sessions = sumField(sessionsGroup, 'totalSessionCount') || sumField(sessionsGroup, 'sessionsCount')
    // Distinct-user counts aren't broken out by the live insights payload the
    // same way sessions are (Clarity reports "distinctUserCount" per popular
    // page, not project-wide) — best-effort sum across whatever page-level
    // breakdown is present; falls back to 0 (not fabricated) when absent.
    const uniqueUsers = sumField(popularPagesGroup, 'distinctUserCount')

    if (sessions === 0 && !sessionsGroup) {
      console.warn(
        '[clarity] project-live-insights response did not contain a recognizable ' +
          '"Traffic" metric group. Clarity may have changed its Data Export API shape — ' +
          'inspect the raw response and update findMetric() lookups in clarity.ts accordingly.'
      )
    }

    return [
      {
        date: endDate || today(),
        sessions,
        bot_sessions_excluded: sumField(botsGroup, 'totalBotSessionCount') || sumField(botsGroup, 'sessionsCount'),
        pages_per_session: averageField(pagesGroup, 'pagesPerSessionPercentage') || averageField(pagesGroup, 'value'),
        scroll_depth_pct: averageField(scrollGroup, 'averageScrollDepth') || averageField(scrollGroup, 'value'),
        active_time_sec: averageField(engagementGroup, 'subTotal') || averageField(engagementGroup, 'value'),
        total_time_sec: averageField(totalTimeGroup, 'subTotal') || averageField(totalTimeGroup, 'value'),
        // TODO(clarity): "new user %" is not exposed by the project-live-insights
        // payload at all (Clarity's UI computes it internally but the export API
        // doesn't surface a NewUser/ReturningUser metric group as of this writing).
        // Defaulting to 0 rather than guessing; revisit if Clarity adds this metric,
        // or backfill via the manual CSV export fallback (see module-level TODO).
        unique_users: uniqueUsers,
        new_user_pct: 0,
      },
    ]
  } catch (err) {
    console.error('[clarity] Error parsing session metrics from Data Export API response:', err)
    return []
  }
}

/**
 * Fetches daily UX friction signals: rage clicks %, dead clicks %, excessive
 * scrolling %, and quick backs %.
 *
 * Same rolling-3-day-window limitation as {@link fetchClaritySessions} — see
 * that function's doc comment and the module-level TODO(clarity) note.
 *
 * Returns `[]` on any failure or when required env vars are missing —
 * never throws.
 */
export async function fetchClarityFriction(
  startDate: string,
  endDate: string
): Promise<ClarityFriction[]> {
  const config = getClarityConfig()
  if (!config) return []

  warnIfOutsideRollingWindow(startDate, endDate)

  const payload = await fetchClarityExport(config, 3)
  if (!payload) return []

  try {
    const rageGroup = findMetric(payload, 'RageClick') ?? findMetric(payload, 'RageClicks')
    const deadGroup = findMetric(payload, 'DeadClick') ?? findMetric(payload, 'DeadClicks')
    const scrollGroup = findMetric(payload, 'ExcessiveScroll') ?? findMetric(payload, 'ExcessiveScrolling')
    const quickBackGroup = findMetric(payload, 'QuickBack') ?? findMetric(payload, 'QuickBacks')

    if (!rageGroup && !deadGroup && !scrollGroup && !quickBackGroup) {
      console.warn(
        '[clarity] project-live-insights response did not contain any recognizable ' +
          'friction metric groups (RageClick/DeadClick/ExcessiveScroll/QuickBack). ' +
          'Clarity may have changed its Data Export API shape, or friction metrics may ' +
          'not be enabled for this project — falling back to an empty result.'
      )
    }

    return [
      {
        date: endDate || today(),
        // The live insights payload reports friction metrics as site-wide
        // aggregates, not broken out per page — 'ALL' matches the
        // clarity_friction table's default for the site-wide row (see
        // supabase/migrations/001_initial_schema.sql). Per-page friction
        // would require the manual CSV export fallback.
        page_url: 'ALL',
        rage_clicks_pct: averageField(rageGroup, 'sessionsWithMetricPercentage') || averageField(rageGroup, 'value'),
        rage_clicks_sessions: sumField(rageGroup, 'sessionsCount') || sumField(rageGroup, 'subTotal'),
        dead_clicks_pct: averageField(deadGroup, 'sessionsWithMetricPercentage') || averageField(deadGroup, 'value'),
        dead_clicks_sessions: sumField(deadGroup, 'sessionsCount') || sumField(deadGroup, 'subTotal'),
        excessive_scrolling_pct:
          averageField(scrollGroup, 'sessionsWithMetricPercentage') || averageField(scrollGroup, 'value'),
        excessive_scrolling_sessions: sumField(scrollGroup, 'sessionsCount') || sumField(scrollGroup, 'subTotal'),
        quick_backs_pct:
          averageField(quickBackGroup, 'sessionsWithMetricPercentage') || averageField(quickBackGroup, 'value'),
        quick_backs_sessions: sumField(quickBackGroup, 'sessionsCount') || sumField(quickBackGroup, 'subTotal'),
      },
    ]
  } catch (err) {
    console.error('[clarity] Error parsing friction metrics from Data Export API response:', err)
    return []
  }
}

/**
 * Logs a warning (does not throw/block) when the requested range extends
 * more than 3 days into the past, since the live Clarity API silently
 * ignores range params and always returns only its rolling window.
 */
function warnIfOutsideRollingWindow(startDate: string, endDate: string): void {
  const start = new Date(startDate)
  const now = new Date()
  const daysAgo = (now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)

  if (Number.isFinite(daysAgo) && daysAgo > 3) {
    console.warn(
      `[clarity] Requested range ${startDate} to ${endDate} extends beyond Clarity's ` +
        "Data Export API rolling 3-day window. The API will still only return its most " +
        'recent ~3 days of data — historical backfill for older dates requires the ' +
        'manual CSV export fallback (see TODO(clarity) notes in lib/api-clients/clarity.ts).'
    )
  }
}
