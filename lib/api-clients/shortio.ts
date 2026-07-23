/**
 * Short.io REST API client.
 *
 * Docs: https://developers.short.io/reference
 *
 * Base URL:  https://api.short.io
 * Auth:      header `Authorization: <SHORTIO_API_KEY>` (Short.io does not use
 *            a "Bearer " prefix — the raw API key is the header value).
 *
 * Server-only. Do not import from a 'use client' component.
 *
 * Required env vars:
 *   - SHORTIO_API_KEY
 *   - SHORTIO_DOMAIN   (e.g. "mrhbnetwork.short.gy")
 */

import type { ShortIOLink, ShortIOClick } from '@/lib/types'

const SHORTIO_BASE_URL = 'https://api.short.io'

/* ------------------------------------------------------------------------ */
/*  Raw Short.io API response shapes                                        */
/* ------------------------------------------------------------------------ */
/*  These interfaces intentionally only declare the subset of fields this   */
/*  client reads. Short.io's actual payloads carry additional fields not    */
/*  modeled here.                                                           */

interface ShortIORawLink {
  idString?: string
  id?: string | number
  shortURL?: string
  secureShortURL?: string
  originalURL: string
  title?: string | null
  createdAt?: string
}

interface ShortIOLinksResponse {
  links?: ShortIORawLink[];
  // Some Short.io accounts/API versions return a bare array instead of a
  // { links: [...] } envelope — both shapes are handled by the caller.
}

/** GET /api/links/statistics/:linkId response (aggregate totals). */
interface ShortIOStatisticsResponse {
  totalClicks?: number
  humanClicks?: number
}

/** Shared shape for the per-dimension breakdown endpoints (countries/os/browsers/referrers). */
interface ShortIOBreakdownEntry {
  // Short.io keys the breakdown by the dimension name itself, e.g.
  // { "United Arab Emirates": 42, "Malaysia": 18 }. We normalize this to
  // an array of { key, clicks } pairs before returning to callers.
  [dimensionValue: string]: number
}

/* ------------------------------------------------------------------------ */
/*  Internal helpers                                                        */
/* ------------------------------------------------------------------------ */

/** Result of validating required Short.io env vars. */
interface ShortIOConfig {
  apiKey: string
  domain: string
}

function getShortIOConfig(): ShortIOConfig | null {
  const apiKey = process.env.SHORTIO_API_KEY
  const domain = process.env.SHORTIO_DOMAIN

  if (!apiKey || !domain) {
    console.error(
      '[shortio] Missing SHORTIO_API_KEY and/or SHORTIO_DOMAIN env vars. ' +
        'Set both in .env.local (see .env.example) and in Vercel Environment Variables.'
    )
    return null
  }

  return { apiKey, domain }
}

function shortIOHeaders(apiKey: string): HeadersInit {
  return {
    Authorization: apiKey,
    Accept: 'application/json',
  }
}

/** Formats a Date (or date-like input) as YYYY-MM-DD. */
function toDateOnly(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toISOString().slice(0, 10)
}

/**
 * Extracts `utm_source` / `utm_medium` / `utm_campaign` from a link's
 * original (destination) URL query string. Short.io itself does not store
 * UTM params as first-class link fields — they only exist as part of
 * whatever query string the link owner appended to the destination URL —
 * so this is the only reliable way to recover them.
 */
function extractUtmParams(originalUrl: string): {
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
} {
  try {
    const url = new URL(originalUrl)
    return {
      utm_source: url.searchParams.get('utm_source'),
      utm_medium: url.searchParams.get('utm_medium'),
      utm_campaign: url.searchParams.get('utm_campaign'),
    }
  } catch {
    // originalURL wasn't a parseable absolute URL — return no UTM data
    // rather than throwing, since this is a best-effort enrichment.
    return { utm_source: null, utm_medium: null, utm_campaign: null }
  }
}

/**
 * Fetches one of the /api/links/statistics/:linkId/{countries,os,browsers,referrers}
 * breakdown endpoints and normalizes the response into `{ key, clicks }[]`.
 * Returns `[]` on any failure (network error, non-2xx, unexpected shape).
 */
async function fetchLinkBreakdown(
  linkId: string,
  dimension: 'countries' | 'os' | 'referrers' | 'browsers',
  startDate: string,
  endDate: string,
  apiKey: string
): Promise<Array<{ key: string; clicks: number }>> {
  try {
    const url = new URL(`${SHORTIO_BASE_URL}/api/links/statistics/${encodeURIComponent(linkId)}/${dimension}`)
    url.searchParams.set('period', 'custom')
    url.searchParams.set('startDate', startDate)
    url.searchParams.set('endDate', endDate)

    const res = await fetch(url.toString(), { headers: shortIOHeaders(apiKey) })

    if (!res.ok) {
      console.error(
        `[shortio] GET /api/links/statistics/${linkId}/${dimension} failed: ${res.status} ${res.statusText}`
      )
      return []
    }

    const json = (await res.json()) as ShortIOBreakdownEntry | { [key: string]: unknown }

    return Object.entries(json)
      .filter(([, value]) => typeof value === 'number')
      .map(([key, clicks]) => ({ key, clicks: clicks as number }))
  } catch (err) {
    console.error(`[shortio] Error fetching ${dimension} breakdown for link ${linkId}:`, err)
    return []
  }
}

/* ------------------------------------------------------------------------ */
/*  Public API                                                              */
/* ------------------------------------------------------------------------ */

/**
 * Fetches all links registered under `SHORTIO_DOMAIN` via GET /api/links.
 *
 * Returns rows shaped to match the `shortio_links` Supabase table
 * (link registry / dimension table — not time-series). UTM params are
 * derived client-side from each link's `originalURL` query string.
 *
 * Return type deliberately omits `id`: `shortio_links.id` is a
 * Postgres-generated `uuid primary key default gen_random_uuid()` (see
 * supabase/migrations/001_initial_schema.sql), not something this client
 * should invent. The ingestion orchestrator upserts these rows keyed on
 * `link_id` (`CONFLICT_COLUMNS.shortio_links = ['link_id']` in
 * lib/ingestion/index.ts), so Postgres assigning `id` itself is correct and
 * expected — sending a non-UUID `id` would fail the whole upsert batch.
 *
 * Returns `[]` on any failure — never throws.
 */
export async function fetchShortIOLinks(): Promise<Omit<ShortIOLink, 'id'>[]> {
  const config = getShortIOConfig()
  if (!config) return []

  try {
    const url = new URL(`${SHORTIO_BASE_URL}/api/links`)
    url.searchParams.set('domain', config.domain)
    url.searchParams.set('limit', '150')

    const res = await fetch(url.toString(), { headers: shortIOHeaders(config.apiKey) })

    if (!res.ok) {
      console.error(`[shortio] GET /api/links failed: ${res.status} ${res.statusText}`)
      return []
    }

    const json = (await res.json()) as ShortIOLinksResponse | ShortIORawLink[]

    // Short.io has returned both a bare array and a { links: [...] } envelope
    // across API versions — normalize to an array before mapping.
    const rawLinks: ShortIORawLink[] = Array.isArray(json) ? json : json.links ?? []

    return rawLinks.map((link) => {
      const linkId = link.idString ?? String(link.id ?? '')
      const utm = extractUtmParams(link.originalURL)

      return {
        link_id: linkId,
        short_url: link.secureShortURL ?? link.shortURL ?? '',
        original_url: link.originalURL,
        title: link.title ?? null,
        utm_source: utm.utm_source,
        utm_medium: utm.utm_medium,
        utm_campaign: utm.utm_campaign,
        created_at: link.createdAt ?? new Date().toISOString(),
      }
    })
  } catch (err) {
    console.error('[shortio] Error fetching links:', err)
    return []
  }
}

/**
 * Fetches click statistics for a single link over `[startDate, endDate]`
 * (inclusive, both formatted YYYY-MM-DD) via:
 *   - GET /api/links/statistics/:linkId               (totals)
 *   - GET /api/links/statistics/:linkId/countries
 *   - GET /api/links/statistics/:linkId/os
 *   - GET /api/links/statistics/:linkId/referrers
 *   - GET /api/links/statistics/:linkId/browsers
 *
 * Short.io's statistics endpoints report aggregate totals per dimension
 * for the requested period rather than a true per-day, per-dimension-value
 * matrix, so this returns one row per (country x os x browser x referrer)
 * combination present in the breakdown data for the period, dated as
 * `endDate` (the period's "as of" date). This matches how the `shortio_clicks`
 * table is intended to be upserted by the daily sync job — callers doing a
 * true daily backfill should call this once per day with startDate ===
 * endDate === that day.
 *
 * Returns `[]` on any failure — never throws.
 */
export async function fetchShortIOClickStats(
  linkId: string,
  startDate: string,
  endDate: string
): Promise<ShortIOClick[]> {
  const config = getShortIOConfig()
  if (!config) return []

  if (!linkId) {
    console.error('[shortio] fetchShortIOClickStats called with an empty linkId.')
    return []
  }

  try {
    const totalsUrl = new URL(`${SHORTIO_BASE_URL}/api/links/statistics/${encodeURIComponent(linkId)}`)
    totalsUrl.searchParams.set('period', 'custom')
    totalsUrl.searchParams.set('startDate', startDate)
    totalsUrl.searchParams.set('endDate', endDate)

    const totalsRes = await fetch(totalsUrl.toString(), { headers: shortIOHeaders(config.apiKey) })

    if (!totalsRes.ok) {
      console.error(
        `[shortio] GET /api/links/statistics/${linkId} failed: ${totalsRes.status} ${totalsRes.statusText}`
      )
      return []
    }

    const totals = (await totalsRes.json()) as ShortIOStatisticsResponse
    const totalClicks = totals.totalClicks ?? 0
    const humanClicks = totals.humanClicks ?? totalClicks

    // Fetch all four breakdown dimensions in parallel.
    const [countries, oses, referrers, browsers] = await Promise.all([
      fetchLinkBreakdown(linkId, 'countries', startDate, endDate, config.apiKey),
      fetchLinkBreakdown(linkId, 'os', startDate, endDate, config.apiKey),
      fetchLinkBreakdown(linkId, 'referrers', startDate, endDate, config.apiKey),
      fetchLinkBreakdown(linkId, 'browsers', startDate, endDate, config.apiKey),
    ])

    // If Short.io returned no dimensional breakdown at all (e.g. a link with
    // zero clicks in the period), still emit a single "ALL dimensions null"
    // row carrying the totals so the period isn't silently dropped.
    if (countries.length === 0 && oses.length === 0 && referrers.length === 0 && browsers.length === 0) {
      return [
        {
          date: endDate,
          link_id: linkId,
          total_clicks: totalClicks,
          human_clicks: humanClicks,
          country: null,
          city: null,
          os: null,
          browser: null,
          referrer: null,
        },
      ]
    }

    // Short.io's per-dimension endpoints don't return a joint distribution
    // (e.g. clicks-by-country-AND-browser), so we can't reconstruct exact
    // per-combination totals without over/under-counting. Instead, emit one
    // breakdown row per dimension value observed, each carrying that
    // dimension's own click count and leaving the other dimension columns
    // null. This keeps the data honest (no fabricated cross-tabulation)
    // while still surfacing per-country / per-OS / per-referrer / per-browser
    // splits for the dashboard's breakdown widgets.
    const rows: ShortIOClick[] = []

    for (const { key, clicks } of countries) {
      rows.push({
        date: endDate,
        link_id: linkId,
        total_clicks: clicks,
        human_clicks: clicks,
        country: key,
        city: null,
        os: null,
        browser: null,
        referrer: null,
      })
    }

    for (const { key, clicks } of oses) {
      rows.push({
        date: endDate,
        link_id: linkId,
        total_clicks: clicks,
        human_clicks: clicks,
        country: null,
        city: null,
        os: key,
        browser: null,
        referrer: null,
      })
    }

    for (const { key, clicks } of browsers) {
      rows.push({
        date: endDate,
        link_id: linkId,
        total_clicks: clicks,
        human_clicks: clicks,
        country: null,
        city: null,
        os: null,
        browser: key,
        referrer: null,
      })
    }

    for (const { key, clicks } of referrers) {
      rows.push({
        date: endDate,
        link_id: linkId,
        total_clicks: clicks,
        human_clicks: clicks,
        country: null,
        city: null,
        os: null,
        browser: null,
        referrer: key,
      })
    }

    return rows
  } catch (err) {
    console.error(`[shortio] Error fetching click stats for link ${linkId}:`, err)
    return []
  }
}

/**
 * Orchestrator: fetches every link under `SHORTIO_DOMAIN`, then fetches click
 * stats for each link over `[startDate, endDate]`, sequentially and with a
 * small delay between requests to stay well under Short.io's per-key rate
 * limit (their published limits are generous, but this keeps a large link
 * registry from bursting many concurrent requests).
 *
 * This is the function a daily sync/cron job should call.
 */
export async function fetchAllShortIOData(
  startDate: string,
  endDate: string
): Promise<{ links: Omit<ShortIOLink, 'id'>[]; clicks: ShortIOClick[] }> {
  const links = await fetchShortIOLinks()

  if (links.length === 0) {
    return { links: [], clicks: [] }
  }

  const clicks: ShortIOClick[] = []

  for (const link of links) {
    const linkClicks = await fetchShortIOClickStats(link.link_id, startDate, endDate)
    clicks.push(...linkClicks)

    // Light throttle between links to avoid hammering the statistics
    // endpoints (4 sequential requests per link already fan out inside
    // fetchShortIOClickStats).
    await new Promise((resolve) => setTimeout(resolve, 150))
  }

  return { links, clicks }
}

// Re-exported for callers that want a quick "today" default without pulling
// in a date library — mirrors the YYYY-MM-DD formatting used throughout this
// module.
export { toDateOnly as formatShortIODate }
