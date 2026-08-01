/**
 * /api/admin/tracked-events
 *
 * GET  → list all admin-configured tracked events (drives the Admin panel and
 *        the User Journey funnel's app-event stages).
 * POST → replace the tracked-events set: upsert the provided rows (by the
 *        unique event_name) and delete any rows no longer present.
 *
 * Uses the service-role client (analytics tables have RLS with no policies).
 * Resilient to the 002 migration not being applied yet: if funnel_stage /
 * stage_order columns are missing, it degrades to the base columns and returns
 * `migrationNeeded: true` so the UI can prompt the operator to run it.
 *
 * Server-only route handler.
 */

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const VALID_CATEGORIES = ['transaction', 'engagement', 'conversion', 'custom']

interface IncomingEvent {
  event_name?: string
  display_name?: string
  category?: string
  is_active?: boolean
  track_as_revenue?: boolean
  funnel_stage?: string | null
  stage_order?: number
}

function looksLikeMissingColumn(message: string): boolean {
  const m = message.toLowerCase()
  return m.includes('funnel_stage') || m.includes('stage_order') || (m.includes('column') && m.includes('does not exist'))
}

export async function GET() {
  try {
    const supabase = createServiceClient()
    // Try full column set first; fall back if the migration isn't applied.
    let migrationNeeded = false
    let rows: any[] = []
    const full = await supabase
      .from('tracked_events')
      .select('id, event_name, display_name, category, is_active, track_as_revenue, funnel_stage, stage_order')
      .order('stage_order', { ascending: true })
      .order('event_name', { ascending: true })
    if (full.error) {
      if (looksLikeMissingColumn(full.error.message)) {
        migrationNeeded = true
        const base = await supabase
          .from('tracked_events')
          .select('id, event_name, display_name, category, is_active, track_as_revenue')
          .order('event_name', { ascending: true })
        if (base.error) return NextResponse.json({ events: [], error: base.error.message })
        rows = (base.data ?? []).map((r) => ({ ...r, funnel_stage: null, stage_order: 0 }))
      } else {
        return NextResponse.json({ events: [], error: full.error.message })
      }
    } else {
      rows = full.data ?? []
    }
    return NextResponse.json({ events: rows, migrationNeeded })
  } catch (error) {
    return NextResponse.json({ events: [], error: error instanceof Error ? error.message : String(error) })
  }
}

export async function POST(request: Request) {
  try {
    const supabase = createServiceClient()
    const body = (await request.json()) as { events?: IncomingEvent[] }
    const incoming = Array.isArray(body.events) ? body.events : []

    // Normalise + dedupe by event_name (last wins); drop rows with no name.
    const byName = new Map<string, any>()
    for (const e of incoming) {
      const name = String(e.event_name ?? '').trim()
      if (!name) continue
      const category = VALID_CATEGORIES.indexOf(String(e.category)) !== -1 ? e.category : 'custom'
      const stageRaw = e.funnel_stage
      const funnel_stage = stageRaw === undefined || stageRaw === null || String(stageRaw).trim() === '' ? null : String(stageRaw).trim()
      byName.set(name, {
        event_name: name,
        display_name: String(e.display_name ?? '').trim() || name,
        category,
        is_active: e.is_active !== false,
        track_as_revenue: e.track_as_revenue === true,
        funnel_stage,
        stage_order: Number.isFinite(Number(e.stage_order)) ? Number(e.stage_order) : 0,
      })
    }
    const rows = Array.from(byName.values())
    const keepNames = rows.map((r) => r.event_name)

    // Delete rows no longer present.
    if (keepNames.length > 0) {
      await supabase.from('tracked_events').delete().not('event_name', 'in', `(${keepNames.map((n) => `"${n}"`).join(',')})`)
    } else {
      await supabase.from('tracked_events').delete().neq('event_name', '')
    }

    // Upsert provided rows (by unique event_name). Retry without the funnel
    // columns if the migration hasn't been applied yet.
    let migrationNeeded = false
    if (rows.length > 0) {
      const up = await supabase.from('tracked_events').upsert(rows, { onConflict: 'event_name' })
      if (up.error) {
        if (looksLikeMissingColumn(up.error.message)) {
          migrationNeeded = true
          const baseRows = rows.map((r) => ({
            event_name: r.event_name,
            display_name: r.display_name,
            category: r.category,
            is_active: r.is_active,
            track_as_revenue: r.track_as_revenue,
          }))
          const up2 = await supabase.from('tracked_events').upsert(baseRows, { onConflict: 'event_name' })
          if (up2.error) return NextResponse.json({ ok: false, error: up2.error.message }, { status: 500 })
        } else {
          return NextResponse.json({ ok: false, error: up.error.message }, { status: 500 })
        }
      }
    }

    return NextResponse.json({ ok: true, count: rows.length, migrationNeeded })
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
