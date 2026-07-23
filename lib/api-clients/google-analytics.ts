/**
 * Google Analytics 4 data fetcher for the MRHB Analytics Dashboard.
 *
 * Uses the Google Analytics Data API v1 (`google.analyticsdata`) to pull
 * report data for the configured GA4 property (GA4_PROPERTY_ID) and reshape
 * each report into the exact row shape the corresponding Supabase table
 * expects (see supabase/migrations/001_initial_schema.sql):
 *
 *   fetchGA4Traffic -> ga_traffic
 *   fetchGA4Pages   -> ga_pages
 *   fetchGA4Events  -> ga_events
 *   fetchGA4Geo     -> ga_geo
 *
 * Server-only module — do not import from a 'use client' component. Callers
 * (API routes, cron/sync jobs) are expected to take the returned arrays and
 * upsert them into Supabase; this module has no Supabase dependency itself.
 */

import { google, type analyticsdata_v1beta } from 'googleapis'
import { getGoogleAuth } from './google-auth'

/**
 * Page size used when paginating `runReport` calls. GA4's API-side ceiling is
 * much higher, but 10,000 rows/page keeps individual requests small and
 * predictable while still minimizing the number of round trips for typical
 * date ranges.
 */
const GA4_MAX_PAGE_SIZE = 10000

/** GA4 reports dates as `YYYYMMDD`; every table we write to uses `YYYY-MM-DD`. */
function formatGA4Date(rawDate: string): string {
  if (!/^\d{8}$/.test(rawDate)) {
    return rawDate
  }
  return `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`
}

/** Safely parses a GA4 metric string value to a number, defaulting to 0. */
function toNumber(value: string | undefined | null): number {
  if (value === undefined || value === null || value === '') return 0
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/* ------------------------------------------------------------------------ */
/*  Row types — mirror the Supabase table columns these functions populate. */
/* ------------------------------------------------------------------------ */

/** Row shape matching the `ga_traffic` table. */
export interface GA4TrafficRow {
  date: string
  sessions: number
  users: number
  new_users: number
  pageviews: number
  bounce_rate: number
  avg_session_duration: number
  channel: string
  source: string
  medium: string
  campaign: string | null
}

/** Row shape matching the `ga_pages` table. */
export interface GA4PageRow {
  date: string
  page_path: string
  page_title: string
  pageviews: number
  avg_time_on_page: number
  exit_rate: number
  entrances: number
}

/** Row shape matching the `ga_events` table. */
export interface GA4EventRow {
  date: string
  event_name: string
  event_count: number
  users: number
  conversions: number
}

/** Row shape matching the `ga_geo` table. */
export interface GA4GeoRow {
  date: string
  country: string
  city: string
  users: number
  sessions: number
  device_category: string
  browser: string
  os: string
}

/* ------------------------------------------------------------------------ */
/*  Shared client + pagination helper                                       */
/* ------------------------------------------------------------------------ */

/**
 * Builds the `analyticsdata` client for the shared service-account auth.
 * Returns `null` if auth couldn't be constructed (missing env vars), so
 * every exported fetcher can bail out early and return `[]`.
 */
function getAnalyticsDataClient(): analyticsdata_v1beta.Analyticsdata | null {
  const auth = getGoogleAuth()
  if (!auth) return null
  return google.analyticsdata({ version: 'v1beta', auth })
}

/** Resolves the configured GA4 property resource name, e.g. `properties/123456789`. */
function getGA4PropertyResource(): string | null {
  const propertyId = process.env.GA4_PROPERTY_ID
  if (!propertyId) {
    console.warn('[google-analytics] Missing GA4_PROPERTY_ID env var — GA4 fetch skipped.')
    return null
  }
  return `properties/${propertyId}`
}

/**
 * Runs a `runReport` request, paginating with `offset`/`limit` until all
 * rows for the given date range and dimension/metric set are collected (or
 * GA4 reports no more rows). Each page requests up to
 * {@link GA4_MAX_PAGE_SIZE} rows.
 */
async function runPaginatedReport(
  client: analyticsdata_v1beta.Analyticsdata,
  property: string,
  request: Pick<
    analyticsdata_v1beta.Schema$RunReportRequest,
    'dateRanges' | 'dimensions' | 'metrics'
  >
): Promise<analyticsdata_v1beta.Schema$Row[]> {
  const allRows: analyticsdata_v1beta.Schema$Row[] = []
  let offset = 0

  while (true) {
    const response = await client.properties.runReport({
      property,
      requestBody: {
        ...request,
        limit: String(GA4_MAX_PAGE_SIZE),
        offset: String(offset),
      },
    })

    const rows = response.data.rows ?? []
    allRows.push(...rows)

    const totalRowCount = response.data.rowCount ?? rows.length
    offset += rows.length

    if (rows.length === 0 || offset >= totalRowCount) {
      break
    }
  }

  return allRows
}

/** Reads dimension values (by index) from a report row, defaulting to `''`. */
function dim(row: analyticsdata_v1beta.Schema$Row, index: number): string {
  return row.dimensionValues?.[index]?.value ?? ''
}

/** Reads metric values (by index) from a report row, defaulting to `'0'`. */
function metric(row: analyticsdata_v1beta.Schema$Row, index: number): string {
  return row.metricValues?.[index]?.value ?? '0'
}

/* ------------------------------------------------------------------------ */
/*  fetchGA4Traffic -> ga_traffic                                            */
/* ------------------------------------------------------------------------ */

/**
 * Fetches GA4 daily traffic broken down by acquisition channel/source/medium,
 * matching the `ga_traffic` table schema.
 *
 * Dimensions: date, sessionDefaultChannelGroup, sessionSource, sessionMedium
 * Metrics: sessions, totalUsers, newUsers, screenPageViews, bounceRate,
 *          averageSessionDuration
 *
 * @param startDate GA4-accepted date string (e.g. `'2026-06-01'` or `'30daysAgo'`)
 * @param endDate GA4-accepted date string (e.g. `'2026-06-30'` or `'today'`)
 */
export async function fetchGA4Traffic(
  startDate: string,
  endDate: string
): Promise<GA4TrafficRow[]> {
  try {
    const client = getAnalyticsDataClient()
    const property = getGA4PropertyResource()
    if (!client || !property) return []

    const rows = await runPaginatedReport(client, property, {
      dateRanges: [{ startDate, endDate }],
      dimensions: [
        { name: 'date' },
        { name: 'sessionDefaultChannelGroup' },
        { name: 'sessionSource' },
        { name: 'sessionMedium' },
      ],
      metrics: [
        { name: 'sessions' },
        { name: 'totalUsers' },
        { name: 'newUsers' },
        { name: 'screenPageViews' },
        { name: 'bounceRate' },
        { name: 'averageSessionDuration' },
      ],
    })

    return rows.map((row): GA4TrafficRow => ({
      date: formatGA4Date(dim(row, 0)),
      channel: dim(row, 1) || '(not set)',
      source: dim(row, 2) || '(not set)',
      medium: dim(row, 3) || '(not set)',
      campaign: null,
      sessions: toNumber(metric(row, 0)),
      users: toNumber(metric(row, 1)),
      new_users: toNumber(metric(row, 2)),
      pageviews: toNumber(metric(row, 3)),
      // GA4 returns bounceRate as a fraction (0-1); store as a percentage
      // (0-100) to match the rest of the dashboard's `_rate`/`_pct` columns.
      bounce_rate: toNumber(metric(row, 4)) * 100,
      avg_session_duration: toNumber(metric(row, 5)),
    }))
  } catch (error) {
    console.error('[google-analytics] fetchGA4Traffic failed:', error)
    return []
  }
}

/* ------------------------------------------------------------------------ */
/*  fetchGA4Pages -> ga_pages                                                */
/* ------------------------------------------------------------------------ */

/**
 * Fetches GA4 daily page-level performance, matching the `ga_pages` table
 * schema.
 *
 * Dimensions: date, pagePath, pageTitle
 * Metrics: screenPageViews, averageSessionDuration, exits (used to compute
 *          exit_rate = exits / screenPageViews), entrances
 */
export async function fetchGA4Pages(
  startDate: string,
  endDate: string
): Promise<GA4PageRow[]> {
  try {
    const client = getAnalyticsDataClient()
    const property = getGA4PropertyResource()
    if (!client || !property) return []

    const rows = await runPaginatedReport(client, property, {
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'date' }, { name: 'pagePath' }, { name: 'pageTitle' }],
      metrics: [
        { name: 'screenPageViews' },
        { name: 'averageSessionDuration' },
        { name: 'exits' },
        { name: 'entrances' },
      ],
    })

    return rows.map((row): GA4PageRow => {
      const pageviews = toNumber(metric(row, 0))
      const exits = toNumber(metric(row, 2))
      const exitRate = pageviews > 0 ? (exits / pageviews) * 100 : 0

      return {
        date: formatGA4Date(dim(row, 0)),
        page_path: dim(row, 1) || '/',
        page_title: dim(row, 2) || '(not set)',
        pageviews,
        avg_time_on_page: toNumber(metric(row, 1)),
        exit_rate: exitRate,
        entrances: toNumber(metric(row, 3)),
      }
    })
  } catch (error) {
    console.error('[google-analytics] fetchGA4Pages failed:', error)
    return []
  }
}

/* ------------------------------------------------------------------------ */
/*  fetchGA4Events -> ga_events                                             */
/* ------------------------------------------------------------------------ */

/**
 * Fetches GA4 daily event counts, matching the `ga_events` table schema.
 *
 * Dimensions: date, eventName
 * Metrics: eventCount, totalUsers, conversions
 */
export async function fetchGA4Events(
  startDate: string,
  endDate: string
): Promise<GA4EventRow[]> {
  try {
    const client = getAnalyticsDataClient()
    const property = getGA4PropertyResource()
    if (!client || !property) return []

    const rows = await runPaginatedReport(client, property, {
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'date' }, { name: 'eventName' }],
      metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }, { name: 'conversions' }],
    })

    return rows.map((row): GA4EventRow => ({
      date: formatGA4Date(dim(row, 0)),
      event_name: dim(row, 1) || '(not set)',
      event_count: toNumber(metric(row, 0)),
      users: toNumber(metric(row, 1)),
      conversions: toNumber(metric(row, 2)),
    }))
  } catch (error) {
    console.error('[google-analytics] fetchGA4Events failed:', error)
    return []
  }
}

/* ------------------------------------------------------------------------ */
/*  fetchGA4Geo -> ga_geo                                                    */
/* ------------------------------------------------------------------------ */

/**
 * Fetches GA4 daily audience breakdown by geography and device, matching the
 * `ga_geo` table schema.
 *
 * Dimensions: date, country, city, deviceCategory, browser, operatingSystem
 * Metrics: totalUsers, sessions
 */
export async function fetchGA4Geo(
  startDate: string,
  endDate: string
): Promise<GA4GeoRow[]> {
  try {
    const client = getAnalyticsDataClient()
    const property = getGA4PropertyResource()
    if (!client || !property) return []

    const rows = await runPaginatedReport(client, property, {
      dateRanges: [{ startDate, endDate }],
      dimensions: [
        { name: 'date' },
        { name: 'country' },
        { name: 'city' },
        { name: 'deviceCategory' },
        { name: 'browser' },
        { name: 'operatingSystem' },
      ],
      metrics: [{ name: 'totalUsers' }, { name: 'sessions' }],
    })

    return rows.map((row): GA4GeoRow => ({
      date: formatGA4Date(dim(row, 0)),
      country: dim(row, 1) || '(not set)',
      city: dim(row, 2) || '(not set)',
      device_category: dim(row, 3) || '(not set)',
      browser: dim(row, 4) || '(not set)',
      os: dim(row, 5) || '(not set)',
      users: toNumber(metric(row, 0)),
      sessions: toNumber(metric(row, 1)),
    }))
  } catch (error) {
    console.error('[google-analytics] fetchGA4Geo failed:', error)
    return []
  }
}
