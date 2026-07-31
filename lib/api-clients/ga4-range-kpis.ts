/**
 * Authoritative per-range GA4 traffic totals for the MRHB Analytics Dashboard.
 *
 * WHY THIS EXISTS
 * The Traffic page used to derive its KPI cards by SUMMING the `ga_traffic`
 * rows, which are broken down by (date × channel × source × medium). GA4's
 * user metrics (`totalUsers`, `newUsers`) are DE-DUPLICATED and NOT additive:
 * summing them across dimension/day rows double-counts the same person many
 * times, which produced the impossible "Users > Sessions" on the dashboard.
 *
 * The only correct way to get a period's user count is to ask GA4 for the
 * total over that exact window with NO breakdown dimensions, so GA4 does the
 * de-duplication. This module does that for each standard dashboard range
 * (today / yesterday / 7d / 30d / 90d), for both the website property
 * (GA4_PROPERTY_ID) and the Sahal Wallet app property (GA4_APP_PROPERTY_ID) —
 * matching the web+app scope the Traffic page's breakdowns already combine —
 * and also fetches the matching PREVIOUS period so the % change is correct
 * even for windows the dashboard's own ga_traffic history doesn't cover yet
 * (GA4 retains far more history than our nightly sync has backfilled).
 *
 * Output rows are shaped for the `daily_kpis` table
 * (unique key: date, source, metric_name), read by app/(dashboard)/traffic.
 *
 * Server-only module — never import from a 'use client' component.
 */

import { google, type analyticsdata_v1beta } from 'googleapis'
import { getGoogleAuth } from './google-auth'

/** De-duplicated GA4 totals for one date window. */
interface Totals {
  sessions: number
  users: number
  new_users: number
  bounce_rate: number
  avg_session_duration: number
}

const ZERO: Totals = {
  sessions: 0,
  users: 0,
  new_users: 0,
  bounce_rate: 0,
  avg_session_duration: 0,
}

/** daily_kpis row shape (source is the analytics_source enum — 'ga4' here). */
export interface DailyKpiRow {
  date: string
  source: 'ga4'
  metric_name: string
  metric_value: number
  period_comparison_pct: number | null
}

function toNum(value: string | undefined | null): number {
  if (value === undefined || value === null || value === '') return 0
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function getClient(): analyticsdata_v1beta.Analyticsdata | null {
  const auth = getGoogleAuth()
  if (!auth) return null
  return google.analyticsdata({ version: 'v1beta', auth })
}

/** Fetches de-duplicated totals for a single [startDate, endDate] window (GA4 inclusive). */
async function periodTotals(
  client: analyticsdata_v1beta.Analyticsdata,
  property: string,
  startDate: string,
  endDate: string
): Promise<Totals> {
  const resp = await client.properties.runReport({
    property,
    requestBody: {
      dateRanges: [{ startDate, endDate }],
      metrics: [
        { name: 'sessions' },
        { name: 'totalUsers' },
        { name: 'newUsers' },
        { name: 'bounceRate' },
        { name: 'averageSessionDuration' },
      ],
    },
  })

  const row = resp.data.rows?.[0]
  const mv = (i: number): number => toNum(row?.metricValues?.[i]?.value)

  return {
    sessions: mv(0),
    users: mv(1),
    new_users: mv(2),
    // GA4 returns bounceRate as a fraction (0-1); store as a percentage.
    bounce_rate: mv(3) * 100,
    avg_session_duration: mv(4),
  }
}

/** Combines website + app totals: additive metrics sum; rates are session-weighted. */
function combine(a: Totals, b: Totals): Totals {
  const sessions = a.sessions + b.sessions
  const weighted = (av: number, bv: number) =>
    sessions > 0 ? (av * a.sessions + bv * b.sessions) / sessions : 0
  return {
    sessions,
    users: a.users + b.users,
    new_users: a.new_users + b.new_users,
    bounce_rate: weighted(a.bounce_rate, b.bounce_rate),
    avg_session_duration: weighted(a.avg_session_duration, b.avg_session_duration),
  }
}

function pctChange(current: number, previous: number): number | null {
  if (previous > 0) return ((current - previous) / previous) * 100
  return null // no comparable baseline — leave null rather than a misleading 100%
}

/**
 * Builds authoritative per-range GA4 traffic KPI rows for the `daily_kpis`
 * table. Windows are UTC and inclusive on both ends (GA4 semantics), mirroring
 * the dashboard's date ranges. Each range needs a current + previous window,
 * fetched for the website property and (when configured) the app property.
 */
export async function fetchGA4TrafficRangeKpis(): Promise<DailyKpiRow[]> {
  try {
    const client = getClient()
    const webProperty = process.env.GA4_PROPERTY_ID
      ? `properties/${process.env.GA4_PROPERTY_ID}`
      : null
    if (!client || !webProperty) {
      console.warn('[ga4-range-kpis] Missing GA4 client or GA4_PROPERTY_ID — skipped.')
      return []
    }
    const appProperty = process.env.GA4_APP_PROPERTY_ID
      ? `properties/${process.env.GA4_APP_PROPERTY_ID}`
      : null

    const DAY_MS = 24 * 60 * 60 * 1000
    const now = new Date()
    const iso = (d: Date): string => d.toISOString().slice(0, 10)
    const ago = (n: number): string => iso(new Date(now.getTime() - n * DAY_MS))
    const today = iso(now)

    // range -> current [start,end] and previous [start,end], inclusive.
    const ranges: Record<string, { cur: [string, string]; prev: [string, string] }> = {
      today: { cur: [today, today], prev: [ago(1), ago(1)] },
      yesterday: { cur: [ago(1), ago(1)], prev: [ago(2), ago(2)] },
      '7d': { cur: [ago(6), today], prev: [ago(13), ago(7)] },
      '30d': { cur: [ago(29), today], prev: [ago(59), ago(30)] },
      '90d': { cur: [ago(89), today], prev: [ago(179), ago(90)] },
    }

    const metricNames: Array<keyof Totals> = [
      'sessions',
      'users',
      'new_users',
      'bounce_rate',
      'avg_session_duration',
    ]

    const rows: DailyKpiRow[] = []

    // Website property ONLY. This is the "Traffic & Acquisition" (website)
    // page, and ga_geo breakdowns are already website-only. Combining the
    // Sahal Wallet app property here would add its de-duplicated user count
    // while contributing almost no "sessions" (Firebase counts sessions
    // differently), which re-creates the impossible Users > Sessions on short
    // windows. App traffic belongs to the App Performance page.
    for (const [range, w] of Object.entries(ranges)) {
      const [current, previous] = await Promise.all([
        periodTotals(client, webProperty, w.cur[0], w.cur[1]),
        periodTotals(client, webProperty, w.prev[0], w.prev[1]),
      ])

      for (const metric of metricNames) {
        rows.push({
          date: today,
          source: 'ga4',
          metric_name: `traffic_${metric}_${range}`,
          metric_value: current[metric],
          period_comparison_pct: pctChange(current[metric], previous[metric]),
        })
      }
    }

    void appProperty
    console.log(`[ga4-range-kpis] Built ${rows.length} daily_kpis rows across ${Object.keys(ranges).length} ranges (website property).`)

    return rows
  } catch (error) {
    console.error('[ga4-range-kpis] fetchGA4TrafficRangeKpis failed:', error)
    return []
  }
}
