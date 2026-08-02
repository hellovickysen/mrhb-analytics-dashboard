/**
 * /api/admin/tool-config
 *
 * GET  → list the tool→event-pattern mappings (App Performance Tool Usage).
 * POST → replace the mapping set (upsert by tool, delete removed rows).
 *
 * Service-role. Resilient to migration 003 not being applied: GET falls back
 * to DEFAULT_TOOL_MAPPINGS and flags `tableMissing`; POST returns
 * `tableMissing:true` without erroring so the UI can prompt to run it.
 */

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { DEFAULT_TOOL_MAPPINGS } from '@/lib/config/tool-usage'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

interface IncomingTool {
  tool?: string
  patterns?: string
  sort_order?: number
  is_active?: boolean
}

function tableMissing(msg: string): boolean {
  const m = msg.toLowerCase()
  return m.includes('tool_usage_config') && (m.includes('does not exist') || m.includes('not find') || m.includes('schema cache'))
}

function defaultsAsRows() {
  return DEFAULT_TOOL_MAPPINGS.map((m) => ({
    tool: m.tool,
    patterns: m.patterns.join(','),
    sort_order: m.sortOrder,
    is_active: m.isActive,
  }))
}

export async function GET() {
  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('tool_usage_config')
      .select('id, tool, patterns, sort_order, is_active')
      .order('sort_order', { ascending: true })
    if (error) {
      if (tableMissing(error.message)) {
        return NextResponse.json({ tools: defaultsAsRows(), tableMissing: true })
      }
      return NextResponse.json({ tools: [], error: error.message })
    }
    const rows = data ?? []
    // Empty table (migration applied but no seed) → show defaults to edit.
    if (rows.length === 0) return NextResponse.json({ tools: defaultsAsRows(), seeded: false })
    return NextResponse.json({ tools: rows })
  } catch (e) {
    return NextResponse.json({ tools: defaultsAsRows(), error: e instanceof Error ? e.message : String(e) })
  }
}

export async function POST(request: Request) {
  try {
    const supabase = createServiceClient()
    const body = (await request.json()) as { tools?: IncomingTool[] }
    const incoming = Array.isArray(body.tools) ? body.tools : []

    const byTool = new Map<string, any>()
    for (const t of incoming) {
      const tool = String(t.tool ?? '').trim()
      if (!tool) continue
      const patterns = String(t.patterns ?? '')
        .split(',')
        .map((p) => p.trim().toUpperCase())
        .filter(Boolean)
        .join(',')
      byTool.set(tool, {
        tool,
        patterns,
        sort_order: Number.isFinite(Number(t.sort_order)) ? Number(t.sort_order) : 0,
        is_active: t.is_active !== false,
      })
    }
    const rows = Array.from(byTool.values())
    const keep = rows.map((r) => r.tool)

    if (keep.length > 0) {
      const del = await supabase.from('tool_usage_config').delete().not('tool', 'in', `(${keep.map((n) => `"${n}"`).join(',')})`)
      if (del.error && tableMissing(del.error.message)) return NextResponse.json({ ok: false, tableMissing: true })
    }
    if (rows.length > 0) {
      const up = await supabase.from('tool_usage_config').upsert(rows, { onConflict: 'tool' })
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
