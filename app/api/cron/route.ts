/**
 * GET /api/cron
 *
 * Vercel cron endpoint — invoked automatically on the schedule declared in
 * vercel.json (`0 * / 6 * * *`, i.e. every 6 hours at 00:00 / 06:00 / 12:00 /
 * 18:00 UTC). Pulls the last 30 days of data from all 5 upstream sources and
 * upserts it into Supabase via {@link runFullIngestion}.
 *
 * SELF-HEALING / FRESHNESS GATE
 * -----------------------------
 * The cron fires every 6 hours, but a full ingestion is expensive and only
 * needs to happen roughly once a day. So before ingesting, this route checks
 * `data_sync_log` for the most recent SUCCESSFUL sync:
 *
 *   - If a successful sync completed within the last {@link STALE_AFTER_MS}
 *     (~20 h) → data is fresh, SKIP (cheap no-op). This is why only one of the
 *     four daily ticks — the one ~24 h after the previous run, i.e. midnight —
 *     actually does work; the others return `skipped: true`.
 *
 *   - If the freshness check itself ERRORS (e.g. the Supabase project is
 *     paused / unreachable) → we do NOT attempt an ingestion that would just
 *     fail. We return 503 and let the next 6-hourly tick retry. This is the
 *     self-healing behaviour: pause the DB for a day or a week, and the FIRST
 *     tick after it's back online detects the stale data and re-syncs
 *     automatically, with no manual trigger. A 30-day ingestion window means
 *     gaps of up to ~30 days are fully backfilled in that single catch-up run.
 *
 *   - Otherwise (stale, or no successful row at all) → run the full ingestion.
 *
 * Pass `?force=1` to bypass the freshness gate (manual/testing recovery).
 *
 * Auth: Vercel signs its own cron invocations with an `x-vercel-cron-auth`
 * header, but this route ALSO accepts a manual `Authorization: Bearer
 * <CRON_SECRET>` header so the same endpoint can be triggered by hand
 * (curl, a scheduled GitHub Action, etc.) for testing or recovery, without
 * needing to fake Vercel's internal header. Requests presenting neither are
 * rejected with 401.
 *
 * Server-only route handler — no 'use client' directive applies here (route
 * handlers never run in the browser).
 */

import { NextResponse } from 'next/server'
import { runFullIngestion } from '@/lib/ingestion'
import { createServiceClient } from '@/lib/supabase/server'

// Vercel Pro plan function timeout. A full 30-day, 5-source ingestion run
// can legitimately take a few minutes; the platform default (10s on Hobby,
// 15s unless configured on Pro) is far too short.
export const maxDuration = 300

// A sync is considered "fresh" if a successful run completed within this
// window. 20 h < the 24 h gap between the midnight run and the previous day's
// run, so the midnight tick always re-syncs while the 06/12/18 ticks skip.
const STALE_AFTER_MS = 20 * 60 * 60 * 1000

/**
 * Verifies the incoming request is either:
 *   1. Vercel's own automatic cron invocation (`x-vercel-cron-auth` header
 *      is present and non-empty — Vercel sets this itself on cron-triggered
 *      requests, so its mere presence is sufficient signal for automatic
 *      invocations that reach this deployment), or
 *   2. A manual invocation carrying `Authorization: Bearer <CRON_SECRET>`
 *      that matches the configured CRON_SECRET env var exactly.
 */
function isAuthorized(request: Request): boolean {
  const vercelCronAuth = request.headers.get('x-vercel-cron-auth')
  if (vercelCronAuth) {
    return true
  }

  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    // No secret configured server-side — a bearer token can never match,
    // so there's nothing further to check here.
    return false
  }

  const authHeader = request.headers.get('authorization')
  return authHeader === `Bearer ${cronSecret}`
}

/**
 * Result of the pre-ingestion freshness probe.
 *   - action 'run'   → data is stale (or absent); proceed with ingestion.
 *   - action 'skip'  → a recent successful sync exists; no work needed.
 *   - action 'defer' → the probe itself failed (DB likely paused/unreachable);
 *                      skip this tick and let the next one retry.
 */
type Freshness =
  | { action: 'run'; reason: string; lastSuccessAt: string | null; ageHours: number | null }
  | { action: 'skip'; reason: string; lastSuccessAt: string; ageHours: number }
  | { action: 'defer'; reason: string; error: string }

async function checkFreshness(): Promise<Freshness> {
  let supabase: ReturnType<typeof createServiceClient>
  try {
    supabase = createServiceClient()
  } catch (error) {
    return { action: 'defer', reason: 'client-init-failed', error: error instanceof Error ? error.message : String(error) }
  }

  const { data, error } = await supabase
    .from('data_sync_log')
    .select('source, started_at, completed_at')
    .eq('status', 'success')
    .order('started_at', { ascending: false })
    .limit(1)

  if (error) {
    // Most likely the Supabase project is paused / unreachable. Don't attempt
    // an ingestion that would just fail — defer to the next tick.
    return { action: 'defer', reason: 'freshness-query-failed', error: error.message }
  }

  const last = data?.[0]
  if (!last) {
    return { action: 'run', reason: 'no-successful-sync-on-record', lastSuccessAt: null, ageHours: null }
  }

  const lastStamp = last.completed_at ?? last.started_at
  const lastMs = lastStamp ? new Date(lastStamp).getTime() : NaN
  if (!Number.isFinite(lastMs)) {
    return { action: 'run', reason: 'unparseable-last-sync-timestamp', lastSuccessAt: lastStamp ?? null, ageHours: null }
  }

  const ageMs = Date.now() - lastMs
  const ageHours = Math.round((ageMs / 3_600_000) * 10) / 10
  if (ageMs < STALE_AFTER_MS) {
    return { action: 'skip', reason: 'data-is-fresh', lastSuccessAt: lastStamp as string, ageHours }
  }
  return { action: 'run', reason: 'data-is-stale', lastSuccessAt: lastStamp as string, ageHours }
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const forced = url.searchParams.get('force') === '1'

  // Freshness gate (unless explicitly forced).
  if (!forced) {
    const freshness = await checkFreshness()

    if (freshness.action === 'defer') {
      // DB unreachable (likely paused). Do not ingest; next tick will retry.
      console.warn(`[api/cron] deferring — ${freshness.reason}: ${freshness.error}`)
      return NextResponse.json(
        { success: false, skipped: true, deferred: true, reason: freshness.reason, error: freshness.error },
        { status: 503 }
      )
    }

    if (freshness.action === 'skip') {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: freshness.reason,
        lastSuccessAt: freshness.lastSuccessAt,
        ageHours: freshness.ageHours,
      })
    }
  }

  const startedAt = Date.now()

  try {
    const summary = await runFullIngestion(30)
    const durationMs = Date.now() - startedAt

    return NextResponse.json({
      success: summary.success,
      forced,
      results: summary.results,
      timing: {
        startedAt: new Date(startedAt).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs,
      },
    })
  } catch (error) {
    const durationMs = Date.now() - startedAt
    const message = error instanceof Error ? error.message : String(error)

    console.error(`[api/cron] runFullIngestion threw: ${message}`)

    return NextResponse.json(
      {
        success: false,
        error: message,
        timing: {
          startedAt: new Date(startedAt).toISOString(),
          completedAt: new Date().toISOString(),
          durationMs,
        },
      },
      { status: 500 }
    )
  }
}
