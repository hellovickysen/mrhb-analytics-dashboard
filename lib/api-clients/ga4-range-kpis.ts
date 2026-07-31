/**
 * Authoritative per-range GA4 traffic totals AND breakdowns for the MRHB
 * Analytics Dashboard, written to the `daily_kpis` table.
 *
 * WHY THIS EXISTS
 * 1. GA4 user metrics (activeUsers/newUsers) are DE-DUPLICATED and NOT additive,
 *    so summing `ga_traffic` rows over-counted users (Users > Sessions). We ask
 *    GA4 for each period's total with no breakdown dimensions so GA4 de-dupes.
 * 2. `ga_traffic` is polluted: historical Sahal Wallet app rows tagged
 *    campaign=null sit permanently in the table (the upsert conflict key
 *    includes campaign, so today's correctly-tagged '(not set)' app rows don't
 *    overwrite the old null ones). That inflated the trend/channel/source
 *    breakdowns ~10x. So we fetch those breakdowns straight from GA4's website
 *    property here and store them authoritatively, bypassing the polluted table.
 *
 * All rows target `daily_kpis` (unique key: date, source, metric_name). We use
 * source='ga4' and structured metric_names:
 *   - traffic_<metric>_<range>            — headline totals (metric_value +
 *                                            period_comparison_pct), one per range.
 *   - traffic_trend_sessions|users        — per-DATE daily trend (date = the day).
 *   - traffic_chan_<range>~~<channel>     — sessions per channel, per range.
 *   - traffic_src_<range>~~<src>~~<med>~~<sessions|users|bounce> — top sources.
 * The page parses these in JS (no SQL LIKE), so '_' in names is harmless.
 *
 * Website property only (GA4_PROPERTY_ID). App traffic belongs to App
 * Performance; ga_geo (device/country/browser) is already website-only.
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

/** daily_kpis row shape (source is the analytics_source enum — 'ga4' here). */
export interface DailyKpiRow {
  date: string
  source: 'ga4'
  metric_name: string
  metric_value: number
  period_comparison_pct: number | null
}

/** Delimiter for encoding channel/source names into metric_name (parsed in JS). */
const SEP = '~~'

function toNum(value: string | undefined | null): number {
  if (value === undefined || value === null || value === '') return 0
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/** GA4 reports dates as `YYYYMMDD`; daily_kpis.date is `YYYY-MM-DD`. */
function formatGA4Date(raw: string | undefined | null): string {
  if (!raw || !/^\d{8}$/.test(raw)) return raw ?? ''
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
}

function getClient(): analyticsdata_v1beta.Analyticsdata | null {
  const auth = getGoogleAuth()
  if (!auth) return null
  return google.analyticsdata({ version: 'v1beta', auth })
}

/** De-duplicated totals for a single [startDate, endDate] window (GA4 inclusive). */
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
        { name: 'activeUsers' },
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
    bounce_rate: mv(3) * 100, // GA4 returns a 0-1 fraction
    avg_session_duration: mv(4),
  }
}

function pctChange(current: number, previous: number): number | null {
  if (previous <= 0) return null
  const pct = ((current - previous) / previous) * 100
  // A baseline that predates the property's data yields absurd swings; treat
  // anything beyond ±500% as "no comparable baseline".
  if (Math.abs(pct) > 500) return null
  return pct
}

/**
 * Builds authoritative per-range GA4 traffic KPI + breakdown rows for the
 * `daily_kpis` table. All windows are UTC and inclusive on both ends (GA4
 * semantics), mirroring the dashboard's date ranges.
 */
export async function fetchGA4TrafficRangeKpis(): Promise<DailyKpiRow[]> {
  try {
    const client = getClient()
    const property = process.env.GA4_PROPERTY_ID
      ? `properties/${process.env.GA4_PROPERTY_ID}`
      : null
    if (!client || !property) {
      console.warn('[ga4-range-kpis] Missing GA4 client or GA4_PROPERTY_ID — skipped.')
      return []
    }

    const DAY_MS = 24 * 60 * 60 * 1000
    const now = new Date()
    const iso = (d: Date): string => d.toISOString().slice(0, 10)
    const ago = (n: number): string => iso(new Date(now.getTime() - n * DAY_MS))
    const today = iso(now)

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

    // ---- Headline totals + channel + sources, per range ----
    for (const [range, w] of Object.entries(ranges)) {
      // Totals (current + previous).
      const [current, previous] = await Promise.all([
        periodTotals(client, property, w.cur[0], w.cur[1]),
        periodTotals(client, property, w.prev[0], w.prev[1]),
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

      // Channel breakdown (sessions per channel).
      try {
        const chResp = await client.properties.runReport({
          property,
          requestBody: {
            dateRanges: [{ startDate: w.cur[0], endDate: w.cur[1] }],
            dimensions: [{ name: 'sessionDefaultChannelGroup' }],
            metrics: [{ name: 'sessions' }],
            orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
            limit: '25',
          },
        })
        for (const row of chResp.data.rows ?? []) {
          const channel = row.dimensionValues?.[0]?.value || '(not set)'
          rows.push({
            date: today,
            source: 'ga4',
            metric_name: `traffic_chan_${range}${SEP}${channel}`,
            metric_value: toNum(row.metricValues?.[0]?.value),
            period_comparison_pct: null,
          })
        }
      } catch (err) {
        console.error(`[ga4-range-kpis] channel ${range} failed:`, err)
      }

      // Top sources/medium (sessions + users + bounce), top 10 by sessions.
      try {
        const srcResp = await client.properties.runReport({
          property,
          requestBody: {
            dateRanges: [{ startDate: w.cur[0], endDate: w.cur[1] }],
            dimensions: [{ name: 'sessionSource' }, { name: 'sessionMedium' }],
            metrics: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'bounceRate' }],
            orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
            limit: '10',
          },
        })
        for (const row of srcResp.data.rows ?? []) {
          const src = row.dimensionValues?.[0]?.value || '(not set)'
          const med = row.dimensionValues?.[1]?.value || '(not set)'
          const base = `traffic_src_${range}${SEP}${src}${SEP}${med}${SEP}`
          rows.push({ date: today, source: 'ga4', metric_name: `${base}sessions`, metric_value: toNum(row.metricValues?.[0]?.value), period_comparison_pct: null })
          rows.push({ date: today, source: 'ga4', metric_name: `${base}users`, metric_value: toNum(row.metricValues?.[1]?.value), period_comparison_pct: null })
          rows.push({ date: today, source: 'ga4', metric_name: `${base}bounce`, metric_value: toNum(row.metricValues?.[2]?.value) * 100, period_comparison_pct: null })
        }
      } catch (err) {
        console.error(`[ga4-range-kpis] sources ${range} failed:`, err)
      }
    }

    // ---- Daily trend (per-date, range-independent), one 90-day query ----
    try {
      const trendResp = await client.properties.runReport({
        property,
        requestBody: {
          dateRanges: [{ startDate: ago(89), endDate: today }],
          dimensions: [{ name: 'date' }],
          metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
          orderBys: [{ dimension: { dimensionName: 'date' } }],
        },
      })
      for (const row of trendResp.data.rows ?? []) {
        const d = formatGA4Date(row.dimensionValues?.[0]?.value)
        if (!d) continue
        rows.push({ date: d, source: 'ga4', metric_name: 'traffic_trend_sessions', metric_value: toNum(row.metricValues?.[0]?.value), period_comparison_pct: null })
        rows.push({ date: d, source: 'ga4', metric_name: 'traffic_trend_users', metric_value: toNum(row.metricValues?.[1]?.value), period_comparison_pct: null })
      }
    } catch (err) {
      console.error('[ga4-range-kpis] trend failed:', err)
    }

    console.log(`[ga4-range-kpis] Built ${rows.length} daily_kpis rows (website property; totals + channel + sources + trend).`)
    return rows
  } catch (error) {
    console.error('[ga4-range-kpis] fetchGA4TrafficRangeKpis failed:', error)
    return []
  }
}
