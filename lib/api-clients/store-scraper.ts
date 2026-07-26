/**
 * App Store / Play Store "keyless" data client.
 *
 * Unlike the other lib/api-clients modules, neither data source here requires
 * an API key or OAuth credential — both are fetched from free, public
 * surfaces:
 *
 *   1. App Store — Apple's iTunes Lookup API (`itunes.apple.com/lookup`).
 *      This is a genuine, documented, unauthenticated JSON API (not a
 *      scrape): https://performance-partners.apple.com/search-api. It
 *      returns the current storefront rating, rating count, version, and
 *      last-update date for a given numeric app id + country storefront.
 *
 *   2. Play Store — there is no equivalent free public API for install
 *      counts/ratings (Android Publisher API and the Play Developer
 *      Reporting API both require a service account with Play Console
 *      access — see lib/api-clients/play-console.ts). Instead, this scrapes
 *      the public, unauthenticated store-listing HTML page
 *      (`play.google.com/store/apps/details?id=...`) and regexes the
 *      install-count / rating / rating-count out of it.
 *
 * IMPORTANT — fragility of the Play Store scrape:
 * Google does not publish or version the Play Store listing page's HTML/JS
 * structure, and has changed it before without notice. The regexes below
 * target two independent signals for resilience:
 *   - The page's embedded structured-data blob (`AF_initDataCallback`),
 *     which carries a `["<label>+", <numeric>, ..., "<short label>+"]`
 *     tuple for the install count and a `["<rating>", <precise rating>]`
 *     tuple for the rating — this is the same JSON Google's own frontend
 *     renders from, so it is the most reliable signal available without an
 *     API key.
 *   - The visible DOM text (`aria-label="Rated X stars..."`, and the
 *     "<label>" + "Downloads" pair of sibling `<div>`s) as a fallback if the
 *     embedded blob's shape changes first.
 * If Google changes the page enough to break *all* of these patterns, every
 * function below fails closed: `fetchPlayStoreData()` returns `null` (with a
 * `console.warn`), never a guessed/fabricated number.
 *
 * Server-only. Do not import from a 'use client' component.
 *
 * Env vars (both optional — see defaults below):
 *   - APP_STORE_ID       (default: '1602366920')
 *   - PLAY_PACKAGE_NAME  (default: 'sahal.wallet.app')
 */

/* ------------------------------------------------------------------------ */
/*  Public types                                                            */
/* ------------------------------------------------------------------------ */

export interface StoreData {
  playStore: {
    /** Raw display string as shown on the store listing, e.g. "100K+". */
    installs: string
    /** Parsed approximation of `installs`, e.g. 100000. */
    installsNumeric: number
    /** Average rating out of 5, e.g. 4.3. */
    rating: number
    /** Total rating count (Play Store's user-facing rating tally). */
    reviews: number
    /** ISO timestamp of when this snapshot was fetched. */
    lastChecked: string
  } | null
  appStore: {
    /** Average rating out of 5 for the `country` storefront, e.g. 4.58. */
    rating: number
    /** Total rating count for the `country` storefront, e.g. 19. */
    ratingCount: number
    /** Current app version string, e.g. "5.07.31". */
    version: string
    /** ISO date the current version was released (from `currentVersionReleaseDate`). */
    lastUpdated: string
    /** ISO timestamp of when this snapshot was fetched. */
    lastChecked: string
  } | null
}

/* ------------------------------------------------------------------------ */
/*  Config                                                                  */
/* ------------------------------------------------------------------------ */

const DEFAULT_APP_STORE_ID = '1602366920'
const DEFAULT_PLAY_PACKAGE_NAME = 'sahal.wallet.app'

/**
 * The App Store id belongs to a Russian-storefront listing — Apple's Lookup
 * API returns per-country rating/rating-count/version data (ratings are not
 * global), so `country=ru` must be passed explicitly or the API silently
 * falls back to the US storefront, which has no data for this app.
 */
const APP_STORE_COUNTRY = 'ru'

function getAppStoreId(): string {
  return process.env.APP_STORE_ID || DEFAULT_APP_STORE_ID
}

function getPlayPackageName(): string {
  return process.env.PLAY_PACKAGE_NAME || DEFAULT_PLAY_PACKAGE_NAME
}

/** Formats a Date as YYYY-MM-DD, matching Postgres `date` columns. */
function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/* ------------------------------------------------------------------------ */
/*  App Store — iTunes Lookup API                                           */
/* ------------------------------------------------------------------------ */

/** Subset of the iTunes Lookup API's per-result fields this client reads. */
interface ITunesLookupResult {
  trackName?: string
  averageUserRating?: number
  userRatingCount?: number
  version?: string
  currentVersionReleaseDate?: string
}

interface ITunesLookupResponse {
  resultCount?: number
  results?: ITunesLookupResult[]
}

/**
 * Fetches the current rating/version snapshot for `APP_STORE_ID` from
 * Apple's free, unauthenticated iTunes Lookup API.
 *
 * Returns `null` on any failure (network error, non-2xx response, empty
 * `results[]`, or malformed JSON) — never throws.
 */
async function fetchAppStoreData(): Promise<NonNullable<StoreData['appStore']> | null> {
  const appId = getAppStoreId()
  const url = `https://itunes.apple.com/lookup?id=${encodeURIComponent(appId)}&country=${APP_STORE_COUNTRY}`

  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      // This is a lightweight, frequently-changing snapshot (rating/version) —
      // never let Next.js's fetch cache serve a stale copy across cron runs.
      cache: 'no-store',
    })

    if (!res.ok) {
      console.error(
        `[store-scraper] iTunes Lookup API request failed for id=${appId}, country=${APP_STORE_COUNTRY}: ` +
          `${res.status} ${res.statusText}`
      )
      return null
    }

    const data = (await res.json()) as ITunesLookupResponse
    const result = data.results?.[0]

    if (!result) {
      console.warn(
        `[store-scraper] iTunes Lookup API returned no results for id=${appId} in the ` +
          `"${APP_STORE_COUNTRY}" storefront. Verify APP_STORE_ID and that the app is listed there.`
      )
      return null
    }

    const rating = typeof result.averageUserRating === 'number' ? result.averageUserRating : 0
    const ratingCount = typeof result.userRatingCount === 'number' ? result.userRatingCount : 0
    const version = result.version ?? ''
    const lastUpdated = result.currentVersionReleaseDate ?? ''

    return {
      rating: Number(rating.toFixed(2)),
      ratingCount,
      version,
      lastUpdated,
      lastChecked: new Date().toISOString(),
    }
  } catch (err) {
    console.error(`[store-scraper] Error fetching iTunes Lookup API for id=${appId}:`, err)
    return null
  }
}

/* ------------------------------------------------------------------------ */
/*  Play Store — public listing page scrape                                 */
/* ------------------------------------------------------------------------ */

/**
 * Browser-like User-Agent for the Play Store HTML fetch. Google serves a
 * meaningfully different (and less complete) page to non-browser user
 * agents on some routes, so this mimics a common mobile Chrome UA rather
 * than using fetch's default (which typically has no User-Agent at all).
 */
const PLAY_STORE_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36'

/**
 * Known Play Store install-count range labels, in ascending order. Google
 * displays installs as one of these bucketed labels (never an exact count)
 * on the public listing page — this list is used both to build the
 * install-count regex alternation and to map a matched label to its
 * approximate numeric value.
 */
const INSTALL_RANGE_LABELS = [
  '0+',
  '1+',
  '5+',
  '10+',
  '50+',
  '100+',
  '500+',
  '1K+',
  '5K+',
  '10K+',
  '50K+',
  '100K+',
  '500K+',
  '1M+',
  '5M+',
  '10M+',
] as const

/**
 * Converts a Play Store install-count label (e.g. "100K+", "1M+", "500+")
 * into an approximate numeric value (e.g. 100000, 1000000, 500).
 *
 * Handles the bucketed labels above plus the comma-separated exact-ish form
 * Google's embedded JSON sometimes carries alongside the label (e.g.
 * "100,000+"), since both can appear depending on which pattern matched.
 *
 * Returns 0 if the label doesn't parse (never throws / never guesses).
 */
function parseInstallCountToNumber(label: string): number {
  const trimmed = label.trim()

  // Comma-separated exact-ish form, e.g. "100,000+" -> 100000.
  if (/^[\d,]+\+?$/.test(trimmed) && trimmed.includes(',')) {
    const digits = trimmed.replace(/[,+]/g, '')
    const asNumber = Number(digits)
    return Number.isFinite(asNumber) ? asNumber : 0
  }

  // Bucketed suffix form, e.g. "100K+", "1M+", "500+".
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*([KMB]?)\+?$/i)
  if (!match) return 0

  const base = Number(match[1])
  if (!Number.isFinite(base)) return 0

  const suffix = match[2].toUpperCase()
  const multiplier = suffix === 'K' ? 1_000 : suffix === 'M' ? 1_000_000 : suffix === 'B' ? 1_000_000_000 : 1

  return Math.round(base * multiplier)
}

/**
 * Extracts the install-count label from the Play Store listing HTML.
 *
 * Tries two independent patterns, most-specific first:
 *   1. Google's embedded structured-data blob carries a tuple like
 *      `["100,000+",100000,227437,"100K+"]` — the trailing quoted string is
 *      the short display label shown in the UI. This is the primary target
 *      since it's the same data Google's own frontend renders from.
 *   2. The rendered DOM pairs the label with a literal "Downloads" caption
 *      in an adjacent element, e.g. `<div ...>100K+</div><div ...>Downloads</div>`.
 *      Used as a fallback if the embedded-JSON shape changes first.
 *
 * Returns `null` if neither pattern matches.
 */
function extractInstallLabel(html: string): string | null {
  const rangeAlternation = INSTALL_RANGE_LABELS.map((l) => l.replace('+', '\\+')).join('|')

  // Pattern 1: embedded JSON tuple's trailing short label, e.g. ...,"100K+"]
  const jsonTupleMatch = html.match(
    new RegExp(`"[\\d,]+\\+",\\d+,\\d+,"(${rangeAlternation})"`, 'i')
  )
  if (jsonTupleMatch) return jsonTupleMatch[1]

  // Pattern 2: visible DOM label immediately followed by a "Downloads" caption.
  const domMatch = html.match(
    new RegExp(`>(${rangeAlternation})<\\/div><div[^>]*>Downloads<`, 'i')
  )
  if (domMatch) return domMatch[1]

  return null
}

/**
 * Extracts the average rating (out of 5) from the Play Store listing HTML.
 *
 * Tries two independent patterns:
 *   1. The accessible `aria-label="Rated X stars out of five stars"` text,
 *      which Google has kept stable for years since it's load-bearing for
 *      screen readers (not just a styling hook).
 *   2. The embedded structured-data blob's `["X.X",X.XXXXXX]` rating tuple.
 *
 * Returns `null` if neither pattern matches.
 */
function extractRating(html: string): number | null {
  const ariaMatch = html.match(/Rated\s+([\d.]+)\s+stars\s+out\s+of\s+five\s+stars/i)
  if (ariaMatch) {
    const rating = Number(ariaMatch[1])
    if (Number.isFinite(rating)) return rating
  }

  const jsonMatch = html.match(/\["(\d\.\d+)",\d\.\d+\]/)
  if (jsonMatch) {
    const rating = Number(jsonMatch[1])
    if (Number.isFinite(rating)) return rating
  }

  return null
}

/**
 * Extracts the total rating count from the Play Store listing HTML.
 *
 * Play Store's embedded structured-data blob carries the rating tuple
 * immediately followed by a 5-bucket star histogram and then a
 * `["<count>",<count>]` tuple for the total rating count, e.g.:
 *   ["4.3",4.304348],[null,["153",153],["0",0],["0",0],["0",0],["729",729]],["883",883],["11",11]
 * The pattern below matches that full sequence (rating tuple -> 5 histogram
 * entries -> total count tuple) so the extracted number is anchored to the
 * correct field rather than an arbitrary "N reviews" string that could
 * belong to an unrelated widget elsewhere on the page (e.g. a "similar
 * apps" carousel).
 *
 * Falls back to a visible-DOM digit count paired with a "reviews" caption
 * if the embedded-JSON shape changes first.
 *
 * Returns `null` if neither pattern matches.
 */
function extractRatingCount(html: string): number | null {
  const histogramMatch = html.match(
    /\["\d\.\d+",\d\.\d+\],\[null(?:,\["\d+",\d+\]){5}\],\["(\d+)",\d+\]/
  )
  if (histogramMatch) {
    const count = Number(histogramMatch[1])
    if (Number.isFinite(count)) return count
  }

  const domMatch = html.match(/>([\d,]+)\s*reviews?</i)
  if (domMatch) {
    const count = Number(domMatch[1].replace(/,/g, ''))
    if (Number.isFinite(count)) return count
  }

  return null
}

/**
 * Fetches and scrapes the public Play Store listing page for
 * `PLAY_PACKAGE_NAME`'s install count, rating, and rating count.
 *
 * Returns `null` (with a `console.warn`) if the page can't be fetched, or if
 * every extraction pattern fails to match — this deliberately never returns
 * a partial/guessed result, since a silently-wrong install count or rating
 * would be worse than an absent one for downstream KPI charts.
 */
async function fetchPlayStoreData(): Promise<NonNullable<StoreData['playStore']> | null> {
  const packageName = getPlayPackageName()
  const url = `https://play.google.com/store/apps/details?id=${encodeURIComponent(packageName)}&hl=en&gl=US`

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': PLAY_STORE_USER_AGENT,
        'Accept-Language': 'en-US,en;q=0.9',
      },
      // Same rationale as the App Store fetch — always get a fresh page.
      cache: 'no-store',
    })

    if (!res.ok) {
      console.error(
        `[store-scraper] Play Store listing page request failed for package=${packageName}: ` +
          `${res.status} ${res.statusText}`
      )
      return null
    }

    const html = await res.text()

    const installLabel = extractInstallLabel(html)
    const rating = extractRating(html)
    const reviews = extractRatingCount(html)

    if (installLabel === null || rating === null || reviews === null) {
      console.warn(
        `[store-scraper] Failed to parse Play Store listing page for package=${packageName} ` +
          `(installLabel=${installLabel}, rating=${rating}, reviews=${reviews}). Google may have ` +
          `changed the page's HTML/JS structure — see the regexes in ` +
          `lib/api-clients/store-scraper.ts (extractInstallLabel/extractRating/extractRatingCount).`
      )
      return null
    }

    return {
      installs: installLabel,
      installsNumeric: parseInstallCountToNumber(installLabel),
      rating,
      reviews,
      lastChecked: new Date().toISOString(),
    }
  } catch (err) {
    console.error(`[store-scraper] Error fetching/parsing Play Store listing page for package=${packageName}:`, err)
    return null
  }
}

/* ------------------------------------------------------------------------ */
/*  Public API                                                              */
/* ------------------------------------------------------------------------ */

/**
 * Fetches current App Store + Play Store snapshots in parallel. Neither
 * source requires an API key/credential (see module doc comment).
 *
 * Each half is independent: a Play Store scrape failure does not affect the
 * App Store result (and vice versa) — either field is `null` on its own
 * failure while the other can still succeed.
 */
export async function fetchStoreData(): Promise<StoreData> {
  const [playStore, appStore] = await Promise.all([
    fetchPlayStoreData().catch((err) => {
      console.error('[store-scraper] fetchPlayStoreData threw unexpectedly:', err)
      return null
    }),
    fetchAppStoreData().catch((err) => {
      console.error('[store-scraper] fetchAppStoreData threw unexpectedly:', err)
      return null
    }),
  ])

  return { playStore, appStore }
}

/**
 * Fetches current store data and shapes it into rows matching the
 * `play_installs` and `play_ratings` Supabase table schemas (see
 * supabase/migrations/001_initial_schema.sql), ready for
 * `upsertRows()` (lib/ingestion/supabase-admin.ts).
 *
 * Only Play Store data feeds these two tables (App Store has no equivalent
 * table in this schema) — `installsNumeric` becomes `play_installs.installs`,
 * and `rating` / `reviews` become `play_ratings.avg_rating` / `.reviews_count`.
 *
 * Both arrays use today's date and are empty (`[]`, not a zeroed row) when
 * the Play Store scrape failed, so a failed scrape never overwrites a prior
 * day's real data with fabricated zeros via upsert.
 *
 * Star-level breakdown (`star_1`..`star_5`) isn't available from the public
 * listing page's aggregate rating/count fields, so it's defaulted to 0 —
 * consistent with how lib/api-clients/play-console.ts's fetchPlayRatings()
 * documents the same limitation for its own data source.
 */
export async function fetchStoreDataForIngestion(): Promise<{
  installs: Record<string, any>[]
  ratings: Record<string, any>[]
}> {
  try {
    const { playStore } = await fetchStoreData()

    if (!playStore) {
      console.warn(
        '[store-scraper] fetchStoreDataForIngestion: Play Store data unavailable — ' +
          'returning empty installs/ratings arrays rather than fabricated zeroed rows.'
      )
      return { installs: [], ratings: [] }
    }

    const date = toDateOnly(new Date())

    const installs: Record<string, any>[] = [
      {
        date,
        installs: playStore.installsNumeric,
        uninstalls: 0,
        active_devices: 0,
        update_installs: 0,
        country: 'ALL',
      },
    ]

    const ratings: Record<string, any>[] = [
      {
        date,
        avg_rating: playStore.rating,
        total_ratings: playStore.reviews,
        star_1: 0,
        star_2: 0,
        star_3: 0,
        star_4: 0,
        star_5: 0,
        reviews_count: playStore.reviews,
      },
    ]

    return { installs, ratings }
  } catch (err) {
    console.error('[store-scraper] fetchStoreDataForIngestion failed:', err)
    return { installs: [], ratings: [] }
  }
}
