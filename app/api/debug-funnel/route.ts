/**
 * TEMPORARY read-only diagnostic for the User Funnel rework. Reports, for a
 * given range (default 30d):
 *   - each funnel stage's raw sum + whether it would fall back to mock
 *   - the real ga_events taxonomy (top event_names by total event_count)
 *   - ga_traffic channel + source values (to fix attribution)
 *   - shortio_clicks link_id grains + the range_<range>/domain_total rows
 * Remove after the rework is designed. No writes.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getDateWindow } from '@/lib/utils/date-range'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function fetchAll(
  supabase: ReturnType<typeof createServiceClient>,
  table: string,
  columns: string,
  since: string,
  until: string,
  maxPages = 30
): Promise<Record<string, any>[]> {
  const all: Record<string, any>[] = []
  const PAGE = 1000
  for (let p = 0; p < maxPages; p++) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .gte('date', since)
      .lte('date', until)
      .order('date', { ascending: true })
      .range(p * PAGE, p * PAGE + PAGE - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    const rows = (data ?? []) as Record<string, any>[]
    all.push(...rows)
    if (rows.length < PAGE) break
  }
  return all
}

function topBy(map: Record<string, number>, n: number): Array<{ key: string; value: number }> {
  return Object.keys(map)
    .map((k) => ({ key: k, value: map[k] }))
    .sort((a, b) => b.value - a.value)
    .slice(0, n)
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const range = url.searchParams.get('range') ?? '30d'
  const supabase = createServiceClient()
  const { startDate: since, endDate: until } = getDateWindow({ range })
  const out: any = { ok: true, range, since, until }

  try {
    // ---- ga_events taxonomy ----
    const events = await fetchAll(supabase, 'ga_events', 'date, event_name, event_count', since, until)
    const byEvent: Record<string, number> = {}
    for (const r of events) {
      const name = String(r.event_name ?? '')
      byEvent[name] = (byEvent[name] ?? 0) + (Number(r.event_count) || 0)
    }
    out.ga_events = {
      rowCount: events.length,
      distinctEventNames: Object.keys(byEvent).length,
      top50: topBy(byEvent, 50),
    }

    // ---- ga_traffic channels + sources ----
    const traffic = await fetchAll(supabase, 'ga_traffic', 'date, channel, source, sessions', since, until)
    const byChannel: Record<string, number> = {}
    const bySource: Record<string, number> = {}
    for (const r of traffic) {
      byChannel[String(r.channel ?? '')] = (byChannel[String(r.channel ?? '')] ?? 0) + (Number(r.sessions) || 0)
      bySource[String(r.source ?? '')] = (bySource[String(r.source ?? '')] ?? 0) + (Number(r.sessions) || 0)
    }
    out.ga_traffic = {
      rowCount: traffic.length,
      channels: topBy(byChannel, 20),
      topSources: topBy(bySource, 25),
    }

    // ---- shortio_clicks grains ----
    const shortio = await fetchAll(
      supabase,
      'shortio_clicks',
      'date, link_id, total_clicks, human_clicks, referrer, country, os',
      since,
      until
    )
    const byLink: Record<string, number> = {}
    for (const r of shortio) byLink[String(r.link_id ?? '')] = (byLink[String(r.link_id ?? '')] ?? 0) + 1
    const rangeRows = shortio
      .filter((r) => r.link_id === `range_${range}` || r.link_id === 'domain_total')
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .slice(0, 6)
    const bySocial = shortio
      .filter((r) => r.link_id === `by_social_${range}` || r.link_id === 'by_social')
      .map((r) => ({ date: r.date, link_id: r.link_id, referrer: r.referrer, total_clicks: r.total_clicks }))
      .slice(0, 20)
    out.shortio = {
      rowCount: shortio.length,
      linkIdCounts: topBy(byLink, 30),
      rangeAndTotalRows: rangeRows,
      socialRows: bySocial,
    }

    // ---- Replicate the funnel's stage queries (real vs would-fall-back) ----
    const stageSum = async (
      table: string,
      build: (q: any) => any
    ): Promise<{ sum: number; error: string | null }> => {
      const { data, error } = await build(supabase.from(table).select('event_count').gte('date', since).lte('date', until))
      if (error) return { sum: 0, error: error.message }
      return { sum: (data ?? []).reduce((s: number, r: any) => s + (Number(r.event_count) || 0), 0), error: null }
    }

    const stage1 = await supabase.from('shortio_clicks').select('total_clicks').eq('link_id', 'domain_total').gte('date', since).lte('date', until)
    const stage1range = await supabase.from('shortio_clicks').select('total_clicks, human_clicks').eq('link_id', `range_${range}`).order('date', { ascending: false }).limit(1)
    const stage2 = await supabase.from('ga_traffic').select('sessions').gte('date', since).lte('date', until).in('channel', ['Social', 'Referral', 'Organic Social'])

    out.stages = {
      stage1_socialDiscovery_domain_total: {
        sum: (stage1.data ?? []).reduce((s: number, r: any) => s + (Number(r.total_clicks) || 0), 0),
        error: stage1.error?.message ?? null,
      },
      stage1_authoritative_range: {
        total_clicks: (stage1range.data?.[0] as any)?.total_clicks ?? null,
        human_clicks: (stage1range.data?.[0] as any)?.human_clicks ?? null,
        error: stage1range.error?.message ?? null,
      },
      stage2_websiteVisit_social_referral: {
        sum: (stage2.data ?? []).reduce((s: number, r: any) => s + (Number(r.sessions) || 0), 0),
        error: stage2.error?.message ?? null,
      },
      stage3_first_open: await stageSum('ga_events', (q) => q.eq('event_name', 'first_open')),
      stage5_SA_APP_DASHBOARD: await stageSum('ga_events', (q) => q.eq('event_name', 'SA_APP_DASHBOARD')),
      stage6_onboarding_complete: await stageSum('ga_events', (q) => q.eq('event_name', 'EW_ONBOARDING_GUIDE_COMPLETE')),
      stage8_session_start: await stageSum('ga_events', (q) => q.eq('event_name', 'session_start')),
    }

    return NextResponse.json(out)
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e), partial: out }, { status: 200 })
  }
}
