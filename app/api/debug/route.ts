import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET() {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) return NextResponse.json({ error: 'Missing Supabase config' })

    const supabase = createClient(url, key)

    // Get all event names with counts — paginate to avoid 1000-row limit
    let allData: any[] = []
    let page = 0
    const pageSize = 1000
    while (true) {
      const { data: batch, error } = await supabase
        .from('ga_events')
        .select('event_name, event_count')
        .order('event_name')
        .range(page * pageSize, (page + 1) * pageSize - 1)
      if (error) return NextResponse.json({ error: error.message })
      if (!batch || batch.length === 0) break
      allData = allData.concat(batch)
      if (batch.length < pageSize) break
      page++
    }
    const data = allData

    // Aggregate by event name
    const eventMap = new Map<string, { count: number; rows: number }>()
    for (const row of data || []) {
      const name = row.event_name || '(unknown)'
      const existing = eventMap.get(name) || { count: 0, rows: 0 }
      existing.count += row.event_count || 0
      existing.rows += 1
      eventMap.set(name, existing)
    }

    // Sort by count descending
    const events = Array.from(eventMap.entries())
      .map(([name, { count, rows }]) => ({ name, count, rows }))
      .sort((a, b) => b.count - a.count)

    // Also search for specific funnel events
    const funnelEvents = [
      'first_open', 'session_start', 'user_engagement',
      'SA_FLASH', 'SA_GET_STARTED', 'SA_APP_DASHBOARD', 'SA_PASSCODE',
      'EW_ONBOARDING_GUIDE_COMPLETE', 'EW_ONBOARDING_LETS_GO',
      'EW_ONBOARDING_IMPORT_WALLET', 'EW_ONBOARDING_GUIDE_SKIP',
      // Dev team's exact transaction events
      'EA_SEND_SENTx', 'EI_SEND_SENTx',
      'EA_SEND_SWAPxLIFI', 'EA_SEND_SWAPxCHANGE_NOW',
      'EA_SEND_SAHAL_STAKEx', 'EA_SEND_MRHB_STOREx',
      'app_remove', 'app_update',
    ]

    const funnelMatches: Record<string, number> = {}
    for (const eventName of funnelEvents) {
      const match = eventMap.get(eventName)
      funnelMatches[eventName] = match?.count || 0
    }

    // Also check for partial matches (LIKE patterns)
    const likePatterns = ['SA_', 'SI_', 'EW_', 'EA_SEND', 'EI_SEND', 'EA_T_', 'EA_REF', 'EA_F_', 'first_', 'session_']
    const patternMatches: Record<string, { events: string[]; totalCount: number }> = {}
    for (const pattern of likePatterns) {
      const matching = events.filter(e => e.name.startsWith(pattern))
      patternMatches[pattern] = {
        events: matching.map(e => `${e.name} (${e.count})`),
        totalCount: matching.reduce((sum, e) => sum + e.count, 0),
      }
    }

    return NextResponse.json({
      totalUniqueEvents: events.length,
      totalRows: data?.length || 0,
      funnelMatches,
      patternMatches,
      top50Events: events.slice(0, 50),
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message })
  }
}
