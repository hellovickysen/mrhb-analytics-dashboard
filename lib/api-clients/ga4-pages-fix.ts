/**
 * Corrected GA4 pages fetcher for the MRHB Analytics Dashboard (-> ga_pages).
 *
 * WHY: the original fetchGA4Pages requested the metrics `exits` and
 * `entrances`, which are Universal Analytics metrics that DO NOT exist in the
 * GA4 Data API. Every call 400'd and the fetcher swallowed the error and
 * returned [] — so ga_pages stayed empty and the Blog page fell back to mock,
 * even though GA4 has full page-path data (verified: 89 pages, / = 181 views).
 *
 * This fetcher requests only valid GA4 metrics (screenPageViews,
 * averageSessionDuration). exit_rate/entrances have no GA4 equivalent and
 * aren't used by the Blog page, so they're stored as 0. Paginated to avoid the
 * per-request row cap.
 *
 * Server-only module — never import from a 'use client' component.
 */

import { google, type analyticsdata_v1beta } from 'googleapis'
import { getGoogleAuth } from './google-auth'

export interface GA4PageRow {
  date: string
  page_path: string
  page_title: string
  pageviews: number
  avg_time_on_page: number
  exit_rate: number
  entrances: number
}

function formatGA4Date(raw: string | undefined | null): string {
  if (!raw || !/^\d{8}$/.test(raw)) return raw ?? ''
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
}

function toNumber(value: string | undefined | null): number {
  if (value === undefined || value === null || value === '') return 0
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export async function fetchGA4Pages(startDate: string, endDate: string): Promise<GA4PageRow[]> {
  try {
    const auth = getGoogleAuth()
    const propertyId = process.env.GA4_PROPERTY_ID
    if (!auth || !propertyId) {
      console.warn('[ga4-pages-fix] Missing GA4 auth or GA4_PROPERTY_ID — skipped.')
      return []
    }
    const client: analyticsdata_v1beta.Analyticsdata = google.analyticsdata({ version: 'v1beta', auth })
    const property = `properties/${propertyId}`

    const PAGE = 10000
    const rows: analyticsdata_v1beta.Schema$Row[] = []
    let offset = 0
    while (true) {
      const resp = await client.properties.runReport({
        property,
        requestBody: {
          dateRanges: [{ startDate, endDate }],
          dimensions: [{ name: 'date' }, { name: 'pagePath' }, { name: 'pageTitle' }],
          metrics: [{ name: 'screenPageViews' }, { name: 'averageSessionDuration' }],
          limit: String(PAGE),
          offset: String(offset),
        },
      })
      const page = resp.data.rows ?? []
      rows.push(...page)
      const total = resp.data.rowCount ?? page.length
      offset += page.length
      if (page.length === 0 || offset >= total) break
    }

    return rows.map((row): GA4PageRow => {
      const dv = (i: number) => row.dimensionValues?.[i]?.value ?? ''
      const mv = (i: number) => toNumber(row.metricValues?.[i]?.value)
      return {
        date: formatGA4Date(dv(0)),
        page_path: dv(1) || '/',
        page_title: dv(2) || '(not set)',
        pageviews: mv(0),
        avg_time_on_page: mv(1),
        // No GA4 Data API equivalent for exits/entrances; not used by the Blog
        // page. Stored as 0 rather than crashing the whole fetch on a bad metric.
        exit_rate: 0,
        entrances: 0,
      }
    })
  } catch (error) {
    console.error('[ga4-pages-fix] fetchGA4Pages failed:', error)
    return []
  }
}
