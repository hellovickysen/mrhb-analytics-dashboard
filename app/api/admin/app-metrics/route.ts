/**
 * /api/admin/app-metrics
 *
 * GET  → the App Performance metric→event mappings (drives KPIs/funnel/trend).
 * POST → replace the set (upsert by key, delete removed).
 *
 * Service-role. Resilient to migration 004 not being applied: GET falls back to
 * DEFAULT_APP_METRICS + `tableMissing`; POST returns `tableMissing:true`.
 */

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { DEFAULT_APP_METRICS } from '@/lib/config/app-metrics'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

interface IncomingMetric {
  key?: string
  label?: string
  patterns?: string
  match_type?: string
  description?: string
  used_by?: string
  sort_order?: number
  is_active?: boolean
}

function tableMissing(msg: string): boolean {
  const m = msg.toLowerCase()
  return m.includes('app_metric_map') && (m.includes('does not exist') || m.includes('not find') || m.includes('schema cache'))
}

function defaultsAsRows() {
  return DEFAULT_APP_METRICS.map((m) => ({
    key: m.key,
    label: m.label,
    patterns: m.patterns.join(','),
    match_type: m.matchType,
    description: m.description,
    used_by: m.usedBy,
    sort_order: m.sortOrder,
    is_active: m.isActive,
  }))
}

export async function GET() {
  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('app_metric_map')
      .select('id, key, label, patterns, match_type, description, used_by, sort_order, is_active')
      .order('sort_order', { ascending: true })
    if (error) {
      if (tableMissing(error.message)) return NextResponse.json({ metrics: defaultsAsRows(), tableMissing: true })
      return NextResponse.json({ metrics: [], error: error.message })
    }
    const rows = data ?? []
    if (rows.length === 0) return NextResponse.json({ metrics: defaultsAsRows(), seeded: false })
    return NextResponse.json({ metrics: rows })
  } catch (e) {
    return NextResponse.json({ metrics: defaultsAsRows(), error: e instanceof Error ? e.message : String(e) })
  }
}

export async function POST(request: Request) {
  try {
    const supabase = createServiceClient()
    const body = (await request.json()) as { metrics?: IncomingMetric[] }
    const incoming = Array.isArray(body.metrics) ? body.metrics : []

    const byKey = new Map<string, any>()
    for (const m of incoming) {
      const key = String(m.key ?? '').trim()
      if (!key) continue
      const patterns = String(m.patterns ?? '')
        .split(',')
        .map((p) => p.trim().toUpperCase())
        .filter(Boolean)
        .join(',')
      byKey.set(key, {
        key,
        label: String(m.label ?? key).trim() || key,
        patterns,
        match_type: m.match_type === 'exact' ? 'exact' : 'contains',
        description: String(m.description ?? ''),
        used_by: String(m.used_by ?? ''),
        sort_order: Number.isFinite(Number(m.sort_order)) ? Number(m.sort_order) : 0,
        is_active: m.is_active !== false,
      })
    }
    const rows = Array.from(byKey.values())
    const keep = rows.map((r) => r.key)

    if (keep.length > 0) {
      const del = await supabase.from('app_metric_map').delete().not('key', 'in', `(${keep.map((n) => `"${n}"`).join(',')})`)
      if (del.error && tableMissing(del.error.message)) return NextResponse.json({ ok: false, tableMissing: true })
    }
    if (rows.length > 0) {
      const up = await supabase.from('app_metric_map').upsert(rows, { onConflict: 'key' })
      if (up.error) {
        if (tableMissing(up.error.message)) return NextResponse.json({ ok: false, tableMissing: true })
        return NextResponse.json({ ok: false, error: up.error.message }, { status: 500 })
      }
    }
    return NextResponse.json({ ok: true, count: rows.length })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
