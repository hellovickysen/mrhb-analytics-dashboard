/**
 * POST /api/refresh
 *
 * Manual refresh endpoint — backs the "Sync Now" action surfaced in the
 * sidebar / admin panel (app/(dashboard)/admin/page.tsx). Unlike the daily
 * cron (app/api/cron/route.ts), this is triggered interactively by a signed-in
 * user and defaults to a shorter 7-day window so a manual click resolves
 * quickly rather than re-pulling a full 30 days every time.
 *
 * Body: { source?: 'ga4' | 'gsc' | 'play' | 'shortio' | 'clarity' | 'all', daysBack?: number }
 *   - source omitted or 'all' -> runFullIngestion (every source)
 *   - source is one specific value -> runSourceIngestion (that source only)
 *   - daysBack omitted -> defaults to 7
 *
 * Server-only route handler — no 'use client' directive applies here (route
 * handlers never run in the browser). This route does not itself re-check
 * CRON_SECRET; it's gated by the app's own auth (see middleware.ts), which
 * requires a signed-in session for everything under the dashboard, including
 * the admin panel that calls this endpoint.
 */

import { NextResponse } from 'next/server'
import { runFullIngestion, runSourceIngestion, type IngestionSource } from '@/lib/ingestion'

// Vercel Pro plan function timeout. A manual refresh defaults to a shorter
// 7-day window and/or a single source, so it should resolve well within 2
// minutes even in the worst case (source: 'all', a longer daysBack).
export const maxDuration = 120

/** Manual-refresh request body. `source: 'all'` and an omitted `source` are equivalent. */
interface RefreshRequestBody {
  source?: IngestionSource | 'all'
  daysBack?: number
}

const VALID_SOURCES: readonly IngestionSource[] = ['ga4', 'gsc', 'play', 'shortio', 'clarity']

function isValidSource(value: unknown): value is IngestionSource {
  return typeof value === 'string' && (VALID_SOURCES as readonly string[]).includes(value)
}

/** Manual refreshes default to 7 days — faster than the cron's full 30-day pull. */
const DEFAULT_MANUAL_DAYS_BACK = 7

export async function POST(request: Request) {
  const startedAt = Date.now()

  let body: RefreshRequestBody = {}
  try {
    // An empty/absent body is a valid request (defaults to "all sources,
    // last 7 days"), so only reject when the body is present but isn't
    // parseable JSON.
    const text = await request.text()
    if (text.trim().length > 0) {
      body = JSON.parse(text) as RefreshRequestBody
    }
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON request body' },
      { status: 400 }
    )
  }

  const { source, daysBack } = body

  if (source !== undefined && source !== 'all' && !isValidSource(source)) {
    return NextResponse.json(
      {
        success: false,
        error: `Invalid source "${String(source)}". Must be one of: all, ${VALID_SOURCES.join(', ')}.`,
      },
      { status: 400 }
    )
  }

  if (daysBack !== undefined && (typeof daysBack !== 'number' || !Number.isFinite(daysBack) || daysBack <= 0)) {
    return NextResponse.json(
      { success: false, error: 'Invalid daysBack: must be a positive number.' },
      { status: 400 }
    )
  }

  try {
    const summary =
      source && source !== 'all'
        ? await runSourceIngestion(source, daysBack ?? DEFAULT_MANUAL_DAYS_BACK)
        : await runFullIngestion(daysBack ?? DEFAULT_MANUAL_DAYS_BACK)

    const durationMs = Date.now() - startedAt

    return NextResponse.json({
      success: summary.success,
      source: source ?? 'all',
      daysBack: daysBack ?? DEFAULT_MANUAL_DAYS_BACK,
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

    console.error(`[api/refresh] ingestion threw: ${message}`)

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
