/**
 * Data ingestion orchestrator for the MRHB Analytics Dashboard.
 *
 * Coordinates all 5 upstream API clients (Google Analytics 4, Google Search
 * Console, Google Play Console, Short.io, Microsoft Clarity), fetches each
 * one's daily metrics for a given date window, and upserts the results into
 * their corresponding Supabase tables (see supabase/migrations/001_initial_schema.sql).
 *
 * Two entry points:
 *   - {@link runFullIngestion}   — every source, used by the daily Vercel cron.
 *   - {@link runSourceIngestion} — a single source, used by the manual
 *                                  "Sync Now" refresh endpoint.
 *
 * Both funnel through {@link runSource}, which fetches + upserts one source's
 * tables and writes a single data_sync_log row for that source's run. This
 * keeps the two entry points from duplicating fetch/upsert/log logic and
 * guarantees the log semantics (one row per source per invocation) are
 * identical whether triggered by cron or by hand.
 *
 * Server-only: transitively depends on lib/ingestion/supabase-admin.ts
 * (service-role key) and the api-clients modules (Google service-account
 * key, Short.io/Clarity API tokens). Never import from a 'use client' component.
 */

import { upsertRows, getSupabaseAdmin } from '@/lib/ingestion/supabase-admin'
import type { DataSource } from '@/lib/types'

import {
  fetchGA4Traffic,
  fetchGA4Pages,
  fetchGA4Events,
  fetchGA4Geo,
  fetchGA4AppEvents,
  fetchGA4AppTraffic,
} from '@/lib/api-clients/google-analytics'
import { fetchGSCQueries, fetchGSCPages } from '@/lib/api-clients/search-console'
import {
  fetchPlayInstalls,
  fetchPlayRatings,
  fetchPlayStoreListing,
} from '@/lib/api-clients/play-console'
import { fetchAllShortIOData } from '@/lib/api-clients/shortio'
import { fetchClaritySessions, fetchClarityFriction } from '@/lib/api-clients/clarity'
import { fetchStoreDataForIngestion } from '@/lib/api-clients/store-scraper'

/* ------------------------------------------------------------------------ */
/*  Types                                                                   */
/* ------------------------------------------------------------------------ */

/** One data source identifier, reused from the shared type definitions. */
export type IngestionSource = DataSource

/** Result of upserting a single fetcher's output into a single Supabase table. */
export interface TableSyncResult {
  source: IngestionSource
  table: string
  count: number
  error?: string
}

/** Result of running ingestion for one source (possibly multiple tables). */
export interface SourceSyncResult {
  source: IngestionSource
  success: boolean
  results: TableSyncResult[]
}

/** Overall summary returned by {@link runFullIngestion} / {@link runSourceIngestion}. */
export interface IngestionSummary {
  success: boolean
  results: TableSyncResult[]
}

/**
 * One (fetch, table, conflictColumns) unit of work. `fetch` is wrapped so it
 * can be run through Promise.allSettled without special-casing each source's
 * different fetcher signature.
 */
interface FetchTask {
  table: string
  conflictColumns: string[]
  fetch: () => Promise<Record<string, any>[]>
}

/* ------------------------------------------------------------------------ */
/*  Conflict columns                                                        */
/* ------------------------------------------------------------------------ */

/**
 * UNIQUE-constraint columns per table, used as the `onConflict` target for
 * every upsert. These MUST exactly match the constraint defined in
 * supabase/migrations/001_initial_schema.sql — Postgres requires an exact
 * match to a unique/exclusion constraint for `ON CONFLICT (...)` to resolve,
 * not merely "some subset of unique columns".
 *
 * Two tables here intentionally differ from a naive reading of the table
 * descriptions, because the actual migration constraint is wider:
 *   - ga_traffic:     migration key is (date, channel, source, medium, campaign)
 *                     — `campaign` is nullable but participates in the
 *                     constraint, so it must be included here too.
 *   - shortio_clicks: migration key is (date, link_id, country, city, os,
 *                     browser, referrer) — `city` and `browser` participate
 *                     in the constraint alongside country/os/referrer.
 */
const CONFLICT_COLUMNS = {
  ga_traffic: ['date', 'channel', 'source', 'medium', 'campaign'],
  ga_pages: ['date', 'page_path'],
  ga_events: ['date', 'event_name'],
  ga_geo: ['date', 'country', 'city', 'device_category', 'browser', 'os'],
  gsc_queries: ['date', 'query', 'page'],
  gsc_pages: ['date', 'page'],
  play_installs: ['date', 'country'],
  play_ratings: ['date'],
  play_store_listing: ['date', 'country'],
  shortio_links: ['link_id'],
  shortio_clicks: ['date', 'link_id', 'country', 'city', 'os', 'browser', 'referrer'],
  clarity_sessions: ['date'],
  clarity_friction: ['date', 'page_url'],
} as const satisfies Record<string, string[]>

/* ------------------------------------------------------------------------ */
/*  Date window helper                                                      */
/* ------------------------------------------------------------------------ */

/** Formats a Date as a `YYYY-MM-DD` string in UTC, matching Postgres `date` columns. */
function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * Computes the [startDate, endDate] window as YYYY-MM-DD strings.
 * `endDate` is today; `startDate` is `daysBack` days before today.
 */
function getDateWindow(daysBack: number): { startDate: string; endDate: string } {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - daysBack)

  return {
    startDate: toDateString(start),
    endDate: toDateString(end),
  }
}

/* ------------------------------------------------------------------------ */
/*  Per-source fetch task definitions                                       */
/* ------------------------------------------------------------------------ */

/**
 * Builds the list of fetch tasks for a single source, given the date window.
 * Each task pairs one fetcher call with the Supabase table + conflict
 * columns it should be upserted into.
 *
 * Play Console and Short.io have fetchers with irregular shapes (a
 * date-less ratings snapshot, and a combined links+clicks payload
 * respectively) — both are normalized here into the same
 * `() => Promise<Row[]>` shape so {@link runSource} can treat every task
 * identically.
 */
function buildTasksForSource(
  source: IngestionSource,
  startDate: string,
  endDate: string
): FetchTask[] {
  switch (source) {
    case 'ga4':
      return [
        {
          table: 'ga_traffic',
          conflictColumns: CONFLICT_COLUMNS.ga_traffic,
          fetch: () => fetchGA4Traffic(startDate, endDate),
        },
        {
          table: 'ga_pages',
          conflictColumns: CONFLICT_COLUMNS.ga_pages,
          fetch: () => fetchGA4Pages(startDate, endDate),
        },
        {
          table: 'ga_events',
          conflictColumns: CONFLICT_COLUMNS.ga_events,
          fetch: () => fetchGA4Events(startDate, endDate),
        },
        {
          table: 'ga_geo',
          conflictColumns: CONFLICT_COLUMNS.ga_geo,
          fetch: () => fetchGA4Geo(startDate, endDate),
        },
        // Sahal Wallet Firebase GA4 (app events + app traffic)
        {
          table: 'ga_events',
          conflictColumns: CONFLICT_COLUMNS.ga_events,
          fetch: () => fetchGA4AppEvents(startDate, endDate),
        },
        {
          table: 'ga_traffic',
          conflictColumns: CONFLICT_COLUMNS.ga_traffic,
          fetch: () => fetchGA4AppTraffic(startDate, endDate),
        },
      ]

    case 'gsc':
      return [
        {
          table: 'gsc_queries',
          conflictColumns: CONFLICT_COLUMNS.gsc_queries,
          fetch: () => fetchGSCQueries(startDate, endDate),
        },
        {
          table: 'gsc_pages',
          conflictColumns: CONFLICT_COLUMNS.gsc_pages,
          fetch: () => fetchGSCPages(startDate, endDate),
        },
      ]

    case 'play': {
      // Primary source: scrape public Play Store + App Store pages (no API key needed).
      // Falls back to Play Console API if available, but store scraping covers
      // install counts and ratings without management security concerns.
      const storeData = fetchStoreDataForIngestion()

      return [
        {
          table: 'play_installs',
          conflictColumns: CONFLICT_COLUMNS.play_installs,
          fetch: async () => {
            // Try store scraper first, fall back to Play Console API
            const scraped = await storeData
            if (scraped.installs.length > 0) return scraped.installs
            return fetchPlayInstalls(startDate, endDate)
          },
        },
        {
          table: 'play_ratings',
          conflictColumns: CONFLICT_COLUMNS.play_ratings,
          fetch: async () => {
            const scraped = await storeData
            if (scraped.ratings.length > 0) return scraped.ratings
            return [await fetchPlayRatings()]
          },
        },
        {
          table: 'play_store_listing',
          conflictColumns: CONFLICT_COLUMNS.play_store_listing,
          fetch: () => fetchPlayStoreListing(startDate, endDate),
        },
      ]
    }

    case 'shortio': {
      // fetchAllShortIOData returns both tables' rows in one call (Short.io's
      // API returns link metadata and click stats together per link), so
      // both fetch tasks share one underlying promise via a memoized call —
      // otherwise running them "in parallel" would trigger the fetch twice.
      const shortioData = fetchAllShortIOData(startDate, endDate)

      return [
        {
          table: 'shortio_links',
          conflictColumns: CONFLICT_COLUMNS.shortio_links,
          fetch: async () => (await shortioData).links,
        },
        {
          table: 'shortio_clicks',
          conflictColumns: CONFLICT_COLUMNS.shortio_clicks,
          fetch: async () => (await shortioData).clicks,
        },
      ]
    }

    case 'clarity':
      return [
        {
          table: 'clarity_sessions',
          conflictColumns: CONFLICT_COLUMNS.clarity_sessions,
          fetch: () => fetchClaritySessions(startDate, endDate),
        },
        {
          table: 'clarity_friction',
          conflictColumns: CONFLICT_COLUMNS.clarity_friction,
          fetch: () => fetchClarityFriction(startDate, endDate),
        },
      ]

    default: {
      // Exhaustiveness guard — TypeScript will flag this if IngestionSource
      // ever gains a member that isn't handled above.
      const _exhaustive: never = source
      throw new Error(`[ingestion] Unknown source: ${_exhaustive}`)
    }
  }
}

/* ------------------------------------------------------------------------ */
/*  data_sync_log helpers                                                    */
/* ------------------------------------------------------------------------ */

/**
 * Inserts a `running` row into data_sync_log at the start of a source's run,
 * returning its id so the run can be marked complete afterward. Logging
 * failures are swallowed (not thrown) — a broken audit log must never abort
 * an otherwise-successful data sync.
 */
async function startSyncLog(source: IngestionSource): Promise<string | null> {
  try {
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('data_sync_log')
      .insert({ source, status: 'running', started_at: new Date().toISOString() })
      .select('id')
      .single()

    if (error) {
      console.error(`[ingestion] data_sync_log insert failed for source "${source}": ${error.message}`)
      return null
    }

    return (data as { id: string } | null)?.id ?? null
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[ingestion] data_sync_log insert threw for source "${source}": ${message}`)
    return null
  }
}

/**
 * Marks a previously-started data_sync_log row as complete (success or error).
 * No-ops gracefully if `logId` is null (i.e. {@link startSyncLog} itself failed).
 */
async function completeSyncLog(
  logId: string | null,
  status: 'success' | 'error',
  recordsSynced: number,
  errorMessage?: string
): Promise<void> {
  if (!logId) return

  try {
    const supabase = getSupabaseAdmin()
    const { error } = await supabase
      .from('data_sync_log')
      .update({
        status,
        records_synced: recordsSynced,
        completed_at: new Date().toISOString(),
        error_message: errorMessage ?? null,
      })
      .eq('id', logId)

    if (error) {
      console.error(`[ingestion] data_sync_log update failed for log ${logId}: ${error.message}`)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[ingestion] data_sync_log update threw for log ${logId}: ${message}`)
  }
}

/* ------------------------------------------------------------------------ */
/*  Core per-source runner                                                  */
/* ------------------------------------------------------------------------ */

/**
 * Runs every fetch task for one source, upserts each result, and records the
 * run in data_sync_log as a single row for that source.
 *
 * Tasks within a source run in parallel via Promise.allSettled: a failure in
 * one fetcher/upsert (e.g. GA4 pages) must not prevent the others (e.g. GA4
 * traffic) from completing. The source is considered successful overall only
 * if every task succeeded; otherwise the sync log captures a combined error
 * message from all failing tasks.
 */
async function runSource(
  source: IngestionSource,
  startDate: string,
  endDate: string
): Promise<SourceSyncResult> {
  const logId = await startSyncLog(source)
  const tasks = buildTasksForSource(source, startDate, endDate)

  const settled = await Promise.allSettled(
    tasks.map(async (task): Promise<TableSyncResult> => {
      try {
        const rows = await task.fetch()
        const upsertResult = await upsertRows(task.table, rows, task.conflictColumns)

        return {
          source,
          table: task.table,
          count: upsertResult.count,
          error: upsertResult.success ? undefined : upsertResult.error,
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`[ingestion] ${source}/${task.table}: fetch threw — ${message}`)
        return { source, table: task.table, count: 0, error: message }
      }
    })
  )

  // Every task above already catches its own errors and resolves (rather
  // than rejects) with a TableSyncResult, so Promise.allSettled entries are
  // expected to always be "fulfilled". The "rejected" branch is defensive
  // fallback in case a future refactor introduces a path that throws past
  // the inner try/catch.
  const results: TableSyncResult[] = settled.map((outcome, i) => {
    if (outcome.status === 'fulfilled') {
      return outcome.value
    }
    const message = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)
    return { source, table: tasks[i].table, count: 0, error: message }
  })

  const success = results.every((r) => !r.error)
  const totalCount = results.reduce((sum, r) => sum + r.count, 0)

  if (success) {
    await completeSyncLog(logId, 'success', totalCount)
  } else {
    const combinedError = results
      .filter((r) => r.error)
      .map((r) => `${r.table}: ${r.error}`)
      .join('; ')
    await completeSyncLog(logId, 'error', totalCount, combinedError)
  }

  return { source, success, results }
}

/* ------------------------------------------------------------------------ */
/*  Public entry points                                                     */
/* ------------------------------------------------------------------------ */

/** All 5 supported ingestion sources, in a fixed, stable order. */
const ALL_SOURCES: IngestionSource[] = ['ga4', 'gsc', 'play', 'shortio', 'clarity']

/**
 * Runs ingestion for every one of the 5 data sources, upserting into every
 * table listed in {@link CONFLICT_COLUMNS} and logging one data_sync_log row
 * per source. Intended for the daily Vercel cron (app/api/cron/route.ts).
 *
 * Sources run in parallel via Promise.allSettled — one source erroring out
 * (e.g. a Play Console API outage) must not block the others from syncing.
 *
 * @param daysBack How many days of history to pull, ending today. Defaults
 *                  to 30, matching the cron job's daily "last 30 days" pull.
 */
export async function runFullIngestion(daysBack: number = 30): Promise<IngestionSummary> {
  const { startDate, endDate } = getDateWindow(daysBack)

  console.log(
    `[ingestion] runFullIngestion starting — window ${startDate}..${endDate} (${daysBack} days), sources: ${ALL_SOURCES.join(', ')}`
  )

  const settled = await Promise.allSettled(
    ALL_SOURCES.map((source) => runSource(source, startDate, endDate))
  )

  const sourceResults: SourceSyncResult[] = settled.map((outcome, i) => {
    if (outcome.status === 'fulfilled') {
      return outcome.value
    }
    const message = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)
    console.error(`[ingestion] Source "${ALL_SOURCES[i]}" run threw unexpectedly: ${message}`)
    return {
      source: ALL_SOURCES[i],
      success: false,
      results: [{ source: ALL_SOURCES[i], table: '(unknown)', count: 0, error: message }],
    }
  })

  const results = sourceResults.flatMap((r) => r.results)
  const success = sourceResults.every((r) => r.success)

  console.log(
    `[ingestion] runFullIngestion complete — success=${success}, ` +
      `totalRows=${results.reduce((sum, r) => sum + r.count, 0)}, ` +
      `failedTables=${results.filter((r) => r.error).length}`
  )

  return { success, results }
}

/**
 * Runs ingestion for a single data source only. Used by the manual "Sync
 * Now" refresh endpoint (app/api/refresh/route.ts) so an admin can re-pull
 * one source without waiting on the other four.
 *
 * @param source   Which of the 5 sources to sync.
 * @param daysBack How many days of history to pull, ending today. Defaults to 30.
 */
export async function runSourceIngestion(
  source: IngestionSource,
  daysBack: number = 30
): Promise<IngestionSummary> {
  const { startDate, endDate } = getDateWindow(daysBack)

  console.log(
    `[ingestion] runSourceIngestion starting — source=${source}, window ${startDate}..${endDate} (${daysBack} days)`
  )

  const { success, results } = await runSource(source, startDate, endDate)

  console.log(
    `[ingestion] runSourceIngestion complete — source=${source}, success=${success}, ` +
      `totalRows=${results.reduce((sum, r) => sum + r.count, 0)}`
  )

  return { success, results }
}
