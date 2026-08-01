/**
 * GET /api/admin/sync-status
 *
 * Powers the Admin panel's Data Sources + Sync History sections from the real
 * `data_sync_log` table (service-role read). Returns:
 *   - history: the most recent sync-log rows (source, status, timings, records)
 *   - sources: per known source, its most recent run + most recent SUCCESSFUL
 *     run's record count, so the source cards reflect reality.
 *
 * Always returns HTTP 200; on DB failure it returns empty arrays + `error` so
 * the UI can degrade gracefully.
 */

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const SOURCE_KEYS = ['ga4', 'gsc', 'shortio', 'play', 'clarity']

export async function GET() {
  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('data_sync_log')
      .select('source, status, started_at, completed_at, records_synced, error_message')
      .order('started_at', { ascending: false })
      .limit(80)

    if (error) {
      return NextResponse.json({ history: [], sources: [], error: error.message })
    }

    const rows = (data ?? []) as any[]

    const history = rows.slice(0, 15).map((r) => ({
      source: r.source,
      status: r.status,
      started_at: r.started_at,
      completed_at: r.completed_at,
      records_synced: r.records_synced ?? 0,
      error_message: r.error_message ?? null,
    }))

    const sources = SOURCE_KEYS.map((key) => {
      const recent = rows.find((r) => r.source === key)
      const lastSuccess = rows.find((r) => r.source === key && r.status === 'success')
      return {
        key,
        lastSyncAt: recent ? (recent.completed_at ?? recent.started_at) : null,
        lastStatus: recent ? recent.status : null,
        records: lastSuccess ? (lastSuccess.records_synced ?? 0) : 0,
      }
    })

    return NextResponse.json({ history, sources })
  } catch (e) {
    return NextResponse.json({ history: [], sources: [], error: e instanceof Error ? e.message : String(e) })
  }
}
