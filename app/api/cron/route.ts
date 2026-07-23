/**
 * GET /api/cron
 *
 * Vercel cron endpoint — invoked automatically once daily per the schedule
 * declared in vercel.json (`0 0 * * *`, i.e. daily at 00:00 UTC). Pulls the
 * last 30 days of data from all 5 upstream sources and upserts it into
 * Supabase via {@link runFullIngestion}.
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

// Vercel Pro plan function timeout. A full 30-day, 5-source ingestion run
// can legitimately take a few minutes; the platform default (10s on Hobby,
// 15s unless configured on Pro) is far too short.
export const maxDuration = 300

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

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const startedAt = Date.now()

  try {
    const summary = await runFullIngestion(30)
    const durationMs = Date.now() - startedAt

    return NextResponse.json({
      success: summary.success,
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
