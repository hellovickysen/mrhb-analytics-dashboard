/**
 * Server-side Supabase client for data ingestion.
 *
 * Unlike lib/supabase/server.ts (which authenticates as the signed-in user
 * via cookies + the anon key, subject to RLS) and lib/supabase/client.ts
 * (browser, anon key), this client authenticates with the `service_role`
 * key. The service role bypasses Row Level Security entirely, which is
 * required here: every ingestion table in supabase/migrations/001_initial_schema.sql
 * has RLS enabled with no policies, so only `service_role` can write to them.
 *
 * Server-only: reads SUPABASE_SERVICE_ROLE_KEY from process.env, which must
 * never be exposed to the browser (no NEXT_PUBLIC_ prefix, never imported
 * from a 'use client' component). This module is imported exclusively by
 * the ingestion orchestrator (lib/ingestion/index.ts) and the cron/refresh
 * route handlers, all of which run server-side only.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/** Module-level memoization so repeated calls reuse one client/connection. */
let cachedAdminClient: SupabaseClient | null = null

/**
 * Lazily constructs (and memoizes) the shared service-role Supabase client.
 *
 * Throws if the required env vars are missing — unlike the Google auth
 * helper (which degrades gracefully), a missing service-role key means
 * ingestion literally cannot write anywhere, so callers should fail loudly
 * and immediately rather than silently skip every table.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (cachedAdminClient) {
    return cachedAdminClient
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      '[supabase-admin] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY ' +
        'env vars — cannot create the service-role Supabase client used for ingestion writes.'
    )
  }

  cachedAdminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      // This client never signs a user in — it's a pure server-to-server
      // service credential — so there's no session to persist or refresh.
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  return cachedAdminClient
}

/** Shape returned by {@link upsertRows} — mirrors the ApiResponse convention used elsewhere. */
export interface UpsertResult {
  success: boolean
  count: number
  error?: string
}

/**
 * Upserts rows into a Supabase table, bypassing RLS via the service-role client.
 *
 * Used by every ingestion table write in lib/ingestion/index.ts. `conflictColumns`
 * must exactly match one of the table's UNIQUE constraints (see
 * supabase/migrations/001_initial_schema.sql) — Postgres' `ON CONFLICT` clause
 * requires an exact match to a unique/exclusion constraint, not just "some"
 * overlapping columns, or the upsert throws at the database layer.
 *
 * @param tableName       Target Supabase table, e.g. "ga_traffic".
 * @param rows            Rows to upsert. Each row's keys must be real column names.
 * @param conflictColumns Column names forming the table's UNIQUE constraint,
 *                        e.g. ['date', 'channel', 'source', 'medium', 'campaign'].
 */
export async function upsertRows(
  tableName: string,
  rows: Record<string, any>[],
  conflictColumns: string[]
): Promise<UpsertResult> {
  // Nothing to do — avoid a pointless round-trip and log noise when a
  // fetcher legitimately returns zero rows (e.g. no data for the window).
  if (rows.length === 0) {
    console.log(`[supabase-admin] ${tableName}: 0 rows to upsert, skipping.`)
    return { success: true, count: 0 }
  }

  try {
    const supabase = getSupabaseAdmin()

    // `count: 'exact'` asks PostgREST to report the real number of rows
    // affected by the upsert (via a Content-Range header under the hood).
    // Without it, `count` is always null and we'd have to assume every row
    // in the batch landed — which happens to be true for a single atomic
    // upsert statement, but asking explicitly means the reported count is
    // verified by the database rather than merely "rows we sent".
    const { error, count } = await supabase
      .from(tableName)
      .upsert(rows, { onConflict: conflictColumns.join(','), count: 'exact' })

    if (error) {
      console.error(
        `[supabase-admin] ${tableName}: upsert FAILED for ${rows.length} row(s) — ${error.message}`
      )
      return { success: false, count: 0, error: error.message }
    }

    const upsertedCount = count ?? rows.length
    console.log(`[supabase-admin] ${tableName}: upserted ${upsertedCount} row(s) successfully.`)
    return { success: true, count: upsertedCount }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[supabase-admin] ${tableName}: upsert threw an exception — ${message}`)
    return { success: false, count: 0, error: message }
  }
}
