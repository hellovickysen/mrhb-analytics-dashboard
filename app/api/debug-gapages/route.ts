/**
 * TEMPORARY read-only diagnostic: why is ga_pages empty? Probes the GA4
 * website property with several page dimension/metric combos and reports which
 * return rows. Also reports the ga_pages table row count. Remove after use.
 */
import { NextResponse } from 'next/server'
import { google } from 'googleapis'
import { getGoogleAuth } from '@/lib/api-clients/google-auth'
import { createServiceClient } from '@/lib/supabase/server'

export const maxDuration = 60

export async function GET() {
  const out: any = { ok: true, probes: [] }

  // DB: how many ga_pages rows exist?
  try {
    const supabase = createServiceClient()
    const { count, error } = await supabase.from('ga_pages').select('*', { count: 'exact', head: true })
    out.ga_pages_db_rowcount = error ? `error: ${error.message}` : count
  } catch (e) {
    out.ga_pages_db_rowcount = `threw: ${e instanceof Error ? e.message : String(e)}`
  }

  const auth = getGoogleAuth()
  const propertyId = process.env.GA4_PROPERTY_ID
  if (!auth || !propertyId) {
    out.ok = false
    out.error = `missing auth (${!!auth}) or GA4_PROPERTY_ID (${!!propertyId})`
    return NextResponse.json(out)
  }
  const client = google.analyticsdata({ version: 'v1beta', auth })
  const property = `properties/${propertyId}`
  const dateRanges = [{ startDate: '30daysAgo', endDate: 'today' }]

  const combos: Array<{ label: string; dimensions: string[]; metrics: string[] }> = [
    { label: 'pagePath + screenPageViews', dimensions: ['pagePath'], metrics: ['screenPageViews'] },
    { label: 'pagePath + eventCount', dimensions: ['pagePath'], metrics: ['eventCount'] },
    { label: 'unifiedScreenName + screenPageViews', dimensions: ['unifiedScreenName'], metrics: ['screenPageViews'] },
    { label: 'pageTitle + screenPageViews', dimensions: ['pageTitle'], metrics: ['screenPageViews'] },
    { label: 'landingPage + sessions', dimensions: ['landingPage'], metrics: ['sessions'] },
    { label: 'eventName + eventCount (top events)', dimensions: ['eventName'], metrics: ['eventCount'] },
  ]

  for (const c of combos) {
    try {
      const resp = await client.properties.runReport({
        property,
        requestBody: {
          dateRanges,
          dimensions: c.dimensions.map((name) => ({ name })),
          metrics: c.metrics.map((name) => ({ name })),
          limit: '5',
        },
      })
      const rows = resp.data.rows ?? []
      out.probes.push({
        combo: c.label,
        rowCount: resp.data.rowCount ?? rows.length,
        sample: rows.slice(0, 5).map((r) => ({
          dims: (r.dimensionValues ?? []).map((d) => d.value),
          mets: (r.metricValues ?? []).map((m) => m.value),
        })),
      })
    } catch (e) {
      out.probes.push({ combo: c.label, error: e instanceof Error ? e.message : String(e) })
    }
  }

  return NextResponse.json(out)
}
