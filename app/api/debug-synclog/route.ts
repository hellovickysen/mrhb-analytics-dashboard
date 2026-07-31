/**
 * TEMPORARY read-only diagnostic: inspect data_sync_log to see whether the
 * daily cron is running and whether each source's sync succeeds. Remove after
 * use. Also reports the newest date present in each source table (freshness).
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const maxDuration = 60

export async function GET() {
  const supabase = createServiceClient()
  const out: any = { ok: true, now: new Date().toISOString() }

  // Recent sync-log rows.
  const { data: logs, error: logErr } = await supabase
    .from('data_sync_log')
    .select('source, status, started_at, completed_at, records_synced, error_message')
    .order('started_at', { ascending: false })
    .limit(60)

  if (logErr) {
    out.logError = logErr.message
  } else {
    const rows = logs ?? []
    out.recent = rows.slice(0, 30)
    // Last SUCCESSFUL run per source.
    const lastSuccessBySource: Record<string, any> = {}
    const lastAnyBySource: Record<string, any> = {}
    for (const r of rows as any[]) {
      if (!lastAnyBySource[r.source]) lastAnyBySource[r.source] = { status: r.status, started_at: r.started_at, records: r.records_synced, error: r.error_message }
      if (r.status === 'success' && !lastSuccessBySource[r.source]) {
        lastSuccessBySource[r.source] = { started_at: r.started_at, records: r.records_synced }
      }
    }
    out.lastRunBySource = lastAnyBySource
    out.lastSuccessBySource = lastSuccessBySource
  }

  // Freshness: newest date present in each source table.
  const freshnessTargets: Array<{ label: string; table: string }> = [
    { label: 'ga_traffic', table: 'ga_traffic' },
    { label: 'ga_pages', table: 'ga_pages' },
    { label: 'ga_geo', table: 'ga_geo' },
    { label: 'gsc_queries', table: 'gsc_queries' },
    { label: 'gsc_pages', table: 'gsc_pages' },
    { label: 'shortio_clicks', table: 'shortio_clicks' },
  ]
  out.maxDateByTable = {}
  for (const t of freshnessTargets) {
    const { data, error } = await supabase
      .from(t.table)
      .select('date')
      .order('date', { ascending: false })
      .limit(1)
    out.maxDateByTable[t.label] = error ? `error: ${error.message}` : (data?.[0]?.date ?? null)
  }

  return NextResponse.json(out)
}
