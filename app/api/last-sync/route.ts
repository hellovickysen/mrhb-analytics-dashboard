/**
 * GET /api/last-sync
 *
 * Returns the timestamp of the most recent SUCCESSFUL sync across all sources,
 * read from data_sync_log. Powers the "last synced" label next to the Sidebar
 * Sync button (replacing the old hardcoded placeholder) so it reflects reality.
 *
 * Server-only route handler; reads via the service-role client (analytics
 * tables have RLS enabled with no policies). Always returns HTTP 200 — on any
 * DB failure it returns `{ lastSyncedAt: null, error }` so the client can
 * render a neutral state instead of throwing.
 */

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 15

export async function GET() {
  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('data_sync_log')
      .select('started_at, completed_at')
      .eq('status', 'success')
      .order('started_at', { ascending: false })
      .limit(1)

    if (error) {
      return NextResponse.json({ lastSyncedAt: null, error: error.message })
    }

    const row = data?.[0]
    const stamp = row ? (row.completed_at ?? row.started_at) : null
    return NextResponse.json({ lastSyncedAt: stamp ?? null })
  } catch (error) {
    return NextResponse.json({
      lastSyncedAt: null,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
