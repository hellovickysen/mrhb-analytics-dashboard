/**
 * Google Play Console data fetcher.
 *
 * IMPORTANT — API landscape / limitations:
 * Google Play Console does not expose one unified public API for everything
 * this module needs. Three different Google APIs are stitched together here:
 *
 *   1. Android Publisher API v3 (`androidpublisher`) — stable, well-documented,
 *      OAuth2 service-account friendly. Covers `reviews.list` (used by
 *      {@link fetchPlayRatings}). It does NOT expose install counts, active
 *      devices, or store-listing funnel metrics — those aren't part of this
 *      API's surface at all.
 *   2. Play Developer Reporting API (`playdeveloperreporting`) — the modern,
 *      Google-recommended path for install/crash/rating time series
 *      (`vitals.errors...`, `anrRateMetricSet`, etc.) and, in preview/limited
 *      form, acquisition reports. This is what {@link fetchPlayInstalls} and
 *      {@link fetchPlayStoreListing} are written against, but as of this
 *      writing it:
 *        - Requires the app to be linked to a Google Cloud project with the
 *          API explicitly enabled, PLUS the service account granted access
 *          in Play Console under Setup -> API access.
 *        - Only backfills a rolling ~30-60 day window depending on the
 *          metric set.
 *        - Some acquisition/store-listing metric sets are still rolling out
 *          and may 403/404 for projects that don't have them enabled yet.
 *   3. Play Console's classic bulk-report CSVs (installs, ratings, store
 *      performance, gzipped CSVs in a per-developer Google Cloud Storage
 *      bucket) — no REST API at all; Play Console writes these directly to
 *      GCS. This is the most complete data source in practice but requires
 *      separate GCS bucket access (a different credential/permission set
 *      than the Play Console API scopes used here) and is out of scope for
 *      this fetch-based client.
 *
 * TODO(play-console): If `playdeveloperreporting` calls below fail with
 * 403/404 (API not enabled for this app, or the metric set isn't available
 * yet), the practical fallback is the GCS bulk-reports pipeline described in
 * (3) above — that requires a separate ingestion script (reads gzipped CSVs
 * from `pubsite_prod_rev_<developer-id>` bucket), not a REST client, so it's
 * intentionally not implemented here.
 *
 * Auth: shared Google service-account auth from `getGoogleAuth()`
 * (lib/api-clients/google-auth.ts). The same service account must be added
 * in Play Console under Setup -> API access with, at minimum, "View app
 * information and download bulk reports" permission for `PLAY_PACKAGE_NAME`.
 *
 * Server-only. Do not import from a 'use client' component.
 *
 * Required env vars:
 *   - PLAY_PACKAGE_NAME
 *   - GOOGLE_SERVICE_ACCOUNT_EMAIL   (read by getGoogleAuth())
 *   - GOOGLE_PRIVATE_KEY             (read by getGoogleAuth())
 */

import { google, androidpublisher_v3 } from 'googleapis'
import { getGoogleAuth } from '@/lib/api-clients/google-auth'
import type { PlayInstall, PlayRating, PlayStoreListing } from '@/lib/types'

/**
 * Play Developer Reporting API resource name prefix. Reports live under
 * `apps/{packageName}/...` rather than a numeric app id.
 */
const REPORTING_API_VERSION = 'v1beta1' as const

/* ------------------------------------------------------------------------ */
/*  Internal helpers                                                        */
/* ------------------------------------------------------------------------ */

function getPackageName(): string | null {
  const packageName = process.env.PLAY_PACKAGE_NAME
  if (!packageName) {
    console.error(
      '[play-console] Missing PLAY_PACKAGE_NAME env var. Set it in .env.local ' +
        '(see .env.example) and in Vercel Environment Variables.'
    )
    return null
  }
  return packageName
}

/**
 * Resolves the shared Google auth client and the Play package name together,
 * since every function in this module needs both. Returns `null` (and logs)
 * if either is missing.
 */
function getPlayContext(): { auth: NonNullable<ReturnType<typeof getGoogleAuth>>; packageName: string } | null {
  const auth = getGoogleAuth()
  if (!auth) {
    console.error(
      '[play-console] Google auth unavailable (missing GOOGLE_SERVICE_ACCOUNT_EMAIL / ' +
        'GOOGLE_PRIVATE_KEY) — see lib/api-clients/google-auth.ts.'
    )
    return null
  }

  const packageName = getPackageName()
  if (!packageName) return null

  return { auth, packageName }
}

/** Formats a Date as YYYY-MM-DD. */
function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * Play Developer Reporting API rows come back as a `rows[]` array where each
 * row has parallel `dimensions[]` and `metrics[]` arrays (column order
 * matches the `dimensions` / `metrics` query params sent in the request).
 * With `aggregationPeriod: 'DAILY'`, the API always includes an implicit
 * `dimension: "DATE"` entry per row (in addition to whatever dimensions were
 * explicitly requested, e.g. "country") — this narrows that generic shape
 * into a plain `{ [name]: value }` record, keyed by lowercase dimension/
 * metric name for easy lookup (e.g. `parsed.date`, `parsed.country`).
 */
interface ReportingApiRow {
  dimensions?: Array<{ dimension?: string; stringValue?: string; numericValue?: string }>
  metrics?: Array<{ metric?: string; decimalValue?: { value?: string }; numericValue?: string }>
}

interface ReportingApiResponse {
  rows?: ReportingApiRow[]
  nextPageToken?: string
}

function parseReportRow(row: ReportingApiRow): Record<string, string> {
  const parsed: Record<string, string> = {}

  for (const dim of row.dimensions ?? []) {
    const key = dim.dimension
    if (!key) continue
    // The API returns dimension names like "DATE" / "COUNTRY" (uppercase);
    // normalize to lowercase so callers can use `parsed.date` / `parsed.country`
    // regardless of the exact casing convention in a given API response.
    parsed[key.toLowerCase()] = dim.stringValue ?? dim.numericValue ?? ''
  }

  for (const metric of row.metrics ?? []) {
    const key = metric.metric
    if (!key) continue
    parsed[key] = metric.decimalValue?.value ?? metric.numericValue ?? '0'
  }

  return parsed
}

/**
 * Normalizes a `DATE` dimension value from the Reporting API — which is
 * typically returned as a "YYYYMMDD" string (or occasionally already
 * YYYY-MM-DD) — into this dashboard's canonical YYYY-MM-DD format. Falls
 * back to `fallbackDate` when the value is missing or unparseable.
 */
function normalizeReportDate(rawDate: string | undefined, fallbackDate: string): string {
  if (!rawDate) return fallbackDate

  if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    return rawDate
  }

  if (/^\d{8}$/.test(rawDate)) {
    return `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`
  }

  return fallbackDate
}

/**
 * Issues a raw authenticated request against the Play Developer Reporting
 * API (googleapis' generated client does not yet ship typed bindings for
 * every report resource, so this calls the REST endpoint directly via
 * `fetch` using the same service-account auth used elsewhere in this
 * module). Returns `null` on any failure.
 */
async function fetchReportingApi(
  auth: NonNullable<ReturnType<typeof getGoogleAuth>>,
  reportPath: string,
  body: Record<string, unknown>
): Promise<ReportingApiResponse | null> {
  try {
    // google-auth-library's getAccessToken() resolves an object (`{ token }`)
    // rather than a bare string — destructure explicitly rather than using
    // the resolved value directly, since the raw promise result is truthy
    // even when `.token` itself is null/undefined.
    const { token: accessToken } = await auth.getAccessToken()
    if (!accessToken) {
      console.error('[play-console] Failed to obtain an access token from the service account.')
      return null
    }

    const url = `https://playdeveloperreporting.googleapis.com/${REPORTING_API_VERSION}/${reportPath}:query`

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error(
        `[play-console] Play Developer Reporting API request to ${reportPath} failed: ` +
          `${res.status} ${res.statusText}. ${text}`.trim()
      )
      return null
    }

    return (await res.json()) as ReportingApiResponse
  } catch (err) {
    console.error(`[play-console] Error calling Play Developer Reporting API (${reportPath}):`, err)
    return null
  }
}

/* ------------------------------------------------------------------------ */
/*  Public API                                                              */
/* ------------------------------------------------------------------------ */

/**
 * Fetches daily installs, uninstalls, active devices, and update-installs
 * (optionally by country) for `[startDate, endDate]` via the Play Developer
 * Reporting API's install metric set
 * (`apps/{packageName}/installMetricSet:query`).
 *
 * TODO(play-console): This metric set requires the Play Developer Reporting
 * API to be enabled for the linked GCP project AND the app to have enough
 * install volume/history for Google to populate it — some newly-published
 * or low-volume apps see empty responses even when correctly configured.
 * If this consistently returns `[]` in production, fall back to Play
 * Console's manual "Statistics" CSV export (Play Console -> Statistics ->
 * Installs -> Export) or the GCS bulk-reports pipeline (see module-level
 * TODO(play-console) note) rather than assuming the integration is broken.
 *
 * Returns `[]` on any failure or when required env vars/config are
 * missing — never throws.
 */
export async function fetchPlayInstalls(startDate: string, endDate: string): Promise<PlayInstall[]> {
  const ctx = getPlayContext()
  if (!ctx) return []

  const response = await fetchReportingApi(ctx.auth, `apps/${ctx.packageName}/installMetricSet`, {
    timelineSpec: {
      aggregationPeriod: 'DAILY',
      startTime: dateToTimelinePoint(startDate),
      endTime: dateToTimelinePoint(endDate),
    },
    dimensions: ['country'],
    metrics: ['installs', 'uninstalls', 'activeDevices', 'installsPerDevice'],
    pageSize: 1000,
  })
  // Note: aggregationPeriod: 'DAILY' causes the API to include a "DATE"
  // dimension on every row automatically — it does not need to (and, per the
  // API's own validation, must not) be listed again in `dimensions` above.

  if (!response) {
    console.warn(
      '[play-console] fetchPlayInstalls: Play Developer Reporting API call failed or the ' +
        'installMetricSet is unavailable for this app. Returning an empty array — see ' +
        'TODO(play-console) in lib/api-clients/play-console.ts for fallback options.'
    )
    return []
  }

  const rows = response.rows ?? []

  if (rows.length === 0) {
    console.warn(
      `[play-console] fetchPlayInstalls: no rows returned for ${startDate} to ${endDate}. ` +
        'This may mean the date range is outside the reporting window Google has backfilled, ' +
        'or the app has too little install volume for this metric set to populate.'
    )
    return []
  }

  return rows.map((row) => {
    const parsed = parseReportRow(row)
    return {
      date: normalizeReportDate(parsed.date, startDate),
      installs: Number(parsed.installs ?? 0),
      uninstalls: Number(parsed.uninstalls ?? 0),
      active_devices: Number(parsed.activeDevices ?? 0),
      // installsPerDevice isn't a literal "update installs" count — the
      // Reporting API's install metric set doesn't currently expose a
      // dedicated "this install was an app update" metric distinct from a
      // fresh install. TODO(play-console): revisit if/when Google adds an
      // explicit update-install metric; until then this defaults to 0
      // rather than reporting a fabricated number.
      update_installs: 0,
      country: parsed.country ?? 'ALL',
    }
  })
}

/**
 * Fetches recent reviews via `androidpublisher.reviews.list` and derives the
 * star distribution / average rating / review count from them.
 *
 * IMPORTANT: `reviews.list` returns at most the most recent ~1 page of
 * reviews per call (Android Publisher API paginates via `token`, but Google
 * caps how much review history is retrievable this way — it is NOT a
 * complete historical export of every rating ever given). The returned
 * `avg_rating` / `star_1..star_5` distribution therefore reflects the
 * sampled review set fetched here, not Play Console's true all-time
 * histogram (which Play Console computes from ratings that never got a
 * written review, too — those aren't visible via this API at all).
 *
 * TODO(play-console): For the authoritative all-time rating histogram, use
 * Play Console -> Ratings -> Export, or the GCS bulk "ratings" report
 * (see module-level TODO(play-console) note). This function is a
 * best-effort approximation suitable for a "recent reviews" widget, not the
 * headline avg-rating KPI.
 *
 * Returns a single object with all star buckets/counts zeroed on any
 * failure or when required env vars/config are missing — never throws.
 */
export async function fetchPlayRatings(): Promise<PlayRating> {
  const emptyResult: PlayRating = {
    date: toDateOnly(new Date()),
    avg_rating: 0,
    total_ratings: 0,
    star_1: 0,
    star_2: 0,
    star_3: 0,
    star_4: 0,
    star_5: 0,
    reviews_count: 0,
  }

  const ctx = getPlayContext()
  if (!ctx) return emptyResult

  try {
    const publisher = google.androidpublisher({ version: 'v3', auth: ctx.auth })

    const reviews: androidpublisher_v3.Schema$Review[] = []
    let pageToken: string | undefined

    // Page through all available reviews (bounded — see doc comment above
    // re: Android Publisher API's retrievable-history limits).
    do {
      const res = await publisher.reviews.list({
        packageName: ctx.packageName,
        maxResults: 100,
        token: pageToken,
      })

      reviews.push(...(res.data.reviews ?? []))
      pageToken = res.data.tokenPagination?.nextPageToken ?? undefined
    } while (pageToken)

    if (reviews.length === 0) {
      console.warn(
        `[play-console] fetchPlayRatings: androidpublisher.reviews.list returned no reviews ` +
          `for package ${ctx.packageName}. Returning zeroed distribution.`
      )
      return emptyResult
    }

    const starCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    let ratingSum = 0
    let ratingCount = 0

    for (const review of reviews) {
      const comments = review.comments ?? []
      const latestComment = comments[comments.length - 1]
      const starRating = latestComment?.userComment?.starRating

      if (typeof starRating === 'number' && starRating >= 1 && starRating <= 5) {
        starCounts[starRating as 1 | 2 | 3 | 4 | 5] += 1
        ratingSum += starRating
        ratingCount += 1
      }
    }

    return {
      date: toDateOnly(new Date()),
      avg_rating: ratingCount > 0 ? Number((ratingSum / ratingCount).toFixed(2)) : 0,
      total_ratings: ratingCount,
      star_1: starCounts[1],
      star_2: starCounts[2],
      star_3: starCounts[3],
      star_4: starCounts[4],
      star_5: starCounts[5],
      reviews_count: reviews.length,
    }
  } catch (err) {
    console.error('[play-console] Error fetching reviews via androidpublisher.reviews.list:', err)
    return emptyResult
  }
}

/**
 * Fetches store-listing funnel performance (impressions, visits, installs,
 * install conversion rate) for `[startDate, endDate]` via the Play Developer
 * Reporting API's acquisition/store-performance metric set.
 *
 * TODO(play-console): As of this writing, store-listing acquisition metrics
 * (impressions/visits/conversion) are one of the newer additions to the Play
 * Developer Reporting API and access may need to be explicitly requested/
 * enabled per app — expect 403/404 responses until that's confirmed for
 * `PLAY_PACKAGE_NAME`. The authoritative fallback is Play Console -> Store
 * presence -> Store listing experiments / performance -> Export, or the GCS
 * "store performance" bulk report (see module-level TODO(play-console) note).
 *
 * Returns `[]` on any failure or when required env vars/config are
 * missing — never throws.
 */
export async function fetchPlayStoreListing(startDate: string, endDate: string): Promise<PlayStoreListing[]> {
  const ctx = getPlayContext()
  if (!ctx) return []

  const response = await fetchReportingApi(ctx.auth, `apps/${ctx.packageName}/storePerformanceMetricSet`, {
    timelineSpec: {
      aggregationPeriod: 'DAILY',
      startTime: dateToTimelinePoint(startDate),
      endTime: dateToTimelinePoint(endDate),
    },
    dimensions: ['country'],
    metrics: ['impressions', 'listingVisitors', 'installers'],
    pageSize: 1000,
  })

  if (!response) {
    console.warn(
      '[play-console] fetchPlayStoreListing: Play Developer Reporting API call failed or the ' +
        'storePerformanceMetricSet is unavailable for this app. Returning an empty array — ' +
        'see TODO(play-console) in lib/api-clients/play-console.ts for fallback options.'
    )
    return []
  }

  const rows = response.rows ?? []

  if (rows.length === 0) {
    console.warn(
      `[play-console] fetchPlayStoreListing: no rows returned for ${startDate} to ${endDate}.`
    )
    return []
  }

  return rows.map((row) => {
    const parsed = parseReportRow(row)
    const impressions = Number(parsed.impressions ?? 0)
    const visits = Number(parsed.listingVisitors ?? 0)
    const installs = Number(parsed.installers ?? 0)

    return {
      date: normalizeReportDate(parsed.date, startDate),
      impressions,
      visits,
      installs,
      install_conversion_rate: visits > 0 ? Number(((installs / visits) * 100).toFixed(2)) : 0,
      country: parsed.country ?? 'ALL',
    }
  })
}

/**
 * Converts a YYYY-MM-DD date string into the `{ year, month, day }` /
 * timezone-qualified point shape the Play Developer Reporting API's
 * `timelineSpec.startTime` / `endTime` fields expect.
 */
function dateToTimelinePoint(dateStr: string): {
  year: number
  month: number
  day: number
} {
  const [year, month, day] = dateStr.split('-').map(Number)
  return { year, month, day }
}
