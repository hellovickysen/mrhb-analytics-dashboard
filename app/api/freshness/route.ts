/**
 * GET /api/freshness
 *
 * Reports, per data source, the timestamp of the most recent SUCCESSFUL sync
 * recorded in `data_sync_log`. Powers the dashboard-wide data-freshness bar
 * (see components/layout/DataFreshnessBar.tsx) so a stalled pipeline is
 * visible at a glance instead of silently serving stale numbers.
 *
 * "Freshness" here means *when we last pulled the source*, not the newest data
 * DATE inside it — e.g. Search Console data legitimately lags 2-3 days, but its
 * sync still runs daily, so its sync freshness is the right stall signal.
 *
 * Live sources are flagged stale by the CLIENT against age thresholds
 * (<24h fresh, 24-48h warn, >48h stale). Clarity is intentionally mock, so it
 * is returned with `mock: true` and excluded from warnings.
 *
 * Server-only route handler. Reads via the service-role client (analytics
 * tables have RLS enabled with no policies). Returns HTTP 200 even on DB
 * failure, with `error` set and `sources: []`, so the client can render a
 * neutral "freshness unavailable" state rather than throwing.
 */

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

interface SourceDef {
  key: string
  label: string
  mock: boolean
}

// Sources as they appear in data_sync_log.source. Clarity is intentionally
// mock (Clarity's API routinely returns no data), so it never triggers a
// staleness warning.
const SOURCES: SourceDef[] = [
  { key: 'ga4', label: 'Analytics', mock: false },
  { key: 'gsc', label: 'Search Console', mock: false },
  { key: 'shortio', label: 'Short.io', mock: false },
  { key: 'play', label: 'Play Store', mock: false },
  { key: 'clarity', label: 'Clarity', mock: true },
]

interface FreshnessSource {
  key: string
  label: string
  mock: boolean
  lastSuccessAt: string | null
  ageHours: number | null
}

export async function GET() {
  let supabase: ReturnType<typeof createServiceClient>
  try {
    supabase = createServiceClient()
  } catch (error) {
    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      sources: [] as FreshnessSource[],
    })
  }

  const now = Date.now()

  try {
    const results = await Promise.all(
      SOURCES.map(async (def): Promise<FreshnessSource> => {
        const { data, error } = await supabase
          .from('data_sync_log')
          .select('started_at, completed_at')
          .eq('source', def.key)
          .eq('status', 'success')
          .order('started_at', { ascending: false })
          .limit(1)

        if (error) {
          // Propagate as a thrown error so the outer catch returns the
          // neutral "unavailable" payload (DB likely paused/unreachable).
          throw new Error(error.message)
        }

        const row = data?.[0]
        const stamp = row ? (row.completed_at ?? row.started_at) : null
        const ms = stamp ? new Date(stamp).getTime() : NaN
        const ageHours = Number.isFinite(ms) ? Math.round(((now - ms) / 3_600_000) * 10) / 10 : null

        return {
          key: def.key,
          label: def.label,
          mock: def.mock,
          lastSuccessAt: stamp ?? null,
          ageHours,
        }
      })
    )

    return NextResponse.json({ generatedAt: new Date().toISOString(), sources: results })
  } catch (error) {
    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      sources: [] as FreshnessSource[],
    })
  }
}
