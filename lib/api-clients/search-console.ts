/**
 * Google Search Console data fetcher for the MRHB Analytics Dashboard.
 *
 * Uses the Search Console API (`google.searchconsole`) to run Search
 * Analytics queries against the configured site (GSC_SITE_URL) and reshape
 * the results into the exact row shape the corresponding Supabase table
 * expects (see supabase/migrations/001_initial_schema.sql):
 *
 *   fetchGSCQueries -> gsc_queries
 *   fetchGSCPages   -> gsc_pages
 *
 * Server-only module — do not import from a 'use client' component. Callers
 * (API routes, cron/sync jobs) are expected to take the returned arrays and
 * upsert them into Supabase; this module has no Supabase dependency itself.
 */

import { google, type searchconsole_v1 } from 'googleapis'
import { getGoogleAuth } from './google-auth'

/**
 * Search Console caps `rowLimit` at 25000, but per spec we page in batches
 * of 1000 to keep individual requests small and predictable.
 */
const GSC_PAGE_SIZE = 1000

/** Safety cap on total pages fetched per call, to avoid runaway pagination loops. */
const GSC_MAX_PAGES = 100

/* ------------------------------------------------------------------------ */
/*  Row types — mirror the Supabase table columns these functions populate. */
/* ------------------------------------------------------------------------ */

/** Row shape matching the `gsc_queries` table. */
export interface GSCQueryRow {
  date: string
  query: string
  page: string
  impressions: number
  clicks: number
  ctr: number
  position: number
}

/** Row shape matching the `gsc_pages` table. */
export interface GSCPageRow {
  date: string
  page: string
  impressions: number
  clicks: number
  ctr: number
  position: number
}

/* ------------------------------------------------------------------------ */
/*  Shared client + pagination helper                                       */
/* ------------------------------------------------------------------------ */

/**
 * Builds the `searchconsole` client for the shared service-account auth.
 * Returns `null` if auth couldn't be constructed (missing env vars), so
 * every exported fetcher can bail out early and return `[]`.
 */
function getSearchConsoleClient(): searchconsole_v1.Searchconsole | null {
  const auth = getGoogleAuth()
  if (!auth) return null
  return google.searchconsole({ version: 'v1', auth })
}

/** Resolves the configured GSC site URL, warning (and returning `null`) if unset. */
function getGSCSiteUrl(): string | null {
  const siteUrl = process.env.GSC_SITE_URL
  if (!siteUrl) {
    console.warn('[search-console] Missing GSC_SITE_URL env var — GSC fetch skipped.')
    return null
  }
  return siteUrl
}

/** Safely parses a Search Console numeric field, defaulting to 0. */
function toNumber(value: number | undefined | null): number {
  if (value === undefined || value === null || Number.isNaN(value)) return 0
  return value
}

/**
 * Runs a `searchanalytics.query` request, paginating with `startRow` in
 * batches of {@link GSC_PAGE_SIZE} until Search Console returns a
 * short/empty page (the standard signal that no more rows remain), or the
 * {@link GSC_MAX_PAGES} safety cap is hit.
 */
async function runPaginatedSearchAnalyticsQuery(
  client: searchconsole_v1.Searchconsole,
  siteUrl: string,
  request: Pick<searchconsole_v1.Schema$SearchAnalyticsQueryRequest, 'startDate' | 'endDate' | 'dimensions'>
): Promise<searchconsole_v1.Schema$ApiDataRow[]> {
  const allRows: searchconsole_v1.Schema$ApiDataRow[] = []
  let startRow = 0
  let pageCount = 0

  while (pageCount < GSC_MAX_PAGES) {
    const response = await client.searchanalytics.query({
      siteUrl,
      requestBody: {
        ...request,
        rowLimit: GSC_PAGE_SIZE,
        startRow,
      },
    })

    const rows = response.data.rows ?? []
    allRows.push(...rows)
    pageCount += 1

    if (rows.length < GSC_PAGE_SIZE) {
      break
    }

    startRow += rows.length
  }

  return allRows
}

/* ------------------------------------------------------------------------ */
/*  fetchGSCQueries -> gsc_queries                                           */
/* ------------------------------------------------------------------------ */

/**
 * Fetches Search Console daily query-level search performance, matching the
 * `gsc_queries` table schema.
 *
 * Dimensions: date, query, page
 * Metrics: impressions, clicks, ctr, position
 *
 * @param startDate ISO date string, e.g. `'2026-06-01'`
 * @param endDate ISO date string, e.g. `'2026-06-30'`
 */
export async function fetchGSCQueries(
  startDate: string,
  endDate: string
): Promise<GSCQueryRow[]> {
  try {
    const client = getSearchConsoleClient()
    const siteUrl = getGSCSiteUrl()
    if (!client || !siteUrl) return []

    const rows = await runPaginatedSearchAnalyticsQuery(client, siteUrl, {
      startDate,
      endDate,
      dimensions: ['date', 'query', 'page'],
    })

    return rows.map((row): GSCQueryRow => ({
      date: row.keys?.[0] ?? '',
      query: row.keys?.[1] ?? '',
      page: row.keys?.[2] ?? '',
      impressions: toNumber(row.impressions),
      clicks: toNumber(row.clicks),
      // GSC returns ctr as a fraction (0-1); store as a percentage (0-100)
      // to match the rest of the dashboard's `_rate`/`_pct` columns.
      ctr: toNumber(row.ctr) * 100,
      position: toNumber(row.position),
    }))
  } catch (error) {
    console.error('[search-console] fetchGSCQueries failed:', error)
    return []
  }
}

/* ------------------------------------------------------------------------ */
/*  fetchGSCPages -> gsc_pages                                              */
/* ------------------------------------------------------------------------ */

/**
 * Fetches Search Console daily page-level search performance, matching the
 * `gsc_pages` table schema.
 *
 * Dimensions: date, page
 * Metrics: impressions, clicks, ctr, position
 */
export async function fetchGSCPages(
  startDate: string,
  endDate: string
): Promise<GSCPageRow[]> {
  try {
    const client = getSearchConsoleClient()
    const siteUrl = getGSCSiteUrl()
    if (!client || !siteUrl) return []

    const rows = await runPaginatedSearchAnalyticsQuery(client, siteUrl, {
      startDate,
      endDate,
      dimensions: ['date', 'page'],
    })

    return rows.map((row): GSCPageRow => ({
      date: row.keys?.[0] ?? '',
      page: row.keys?.[1] ?? '',
      impressions: toNumber(row.impressions),
      clicks: toNumber(row.clicks),
      ctr: toNumber(row.ctr) * 100,
      position: toNumber(row.position),
    }))
  } catch (error) {
    console.error('[search-console] fetchGSCPages failed:', error)
    return []
  }
}
