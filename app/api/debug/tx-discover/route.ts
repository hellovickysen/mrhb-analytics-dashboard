import { NextResponse } from 'next/server'
import { google, type analyticsdata_v1beta } from 'googleapis'
import { getGoogleAuth } from '@/lib/api-clients/google-auth'

// TEMPORARY read-only discovery route: enumerates transaction-related GA4 event
// names (eventName x platform, activeUsers + eventCount) so we can map the 7
// transaction categories to real event patterns. DELETE after reading.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function toNum(v: string | undefined | null): number {
  if (v === undefined || v === null || v === '') return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
function fmt(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// Broad net across every likely transaction token for the 7 categories.
const TX_DISCOVERY_REGEX =
  '(SWAP|STAKE|STORE|MIRO|EMPLIFAI|ESIM|COINFORMANCE|VOTE|TOPUP|TOP_UP|SUBSCRI|SEND|GIVE|RAMP|BUY|PURCHASE|CARD|MRHB_STORE)'

export async function GET(request: Request) {
  try {
    const auth = getGoogleAuth()
    const propertyId = process.env.GA4_APP_PROPERTY_ID
    if (!auth || !propertyId) return NextResponse.json({ error: 'Missing GA4 auth or GA4_APP_PROPERTY_ID' })
    const client: analyticsdata_v1beta.Analyticsdata = google.analyticsdata({ version: 'v1beta', auth })
    const property = `properties/${propertyId}`

    const url = new URL(request.url)
    const days = Math.min(365, Math.max(1, Number(url.searchParams.get('days')) || 90))
    const now = new Date()
    const startDate = fmt(new Date(now.getTime() - days * 86400000))
    const endDate = fmt(now)

    const resp = await client.properties.runReport({
      property,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'eventName' }, { name: 'platform' }],
        metrics: [{ name: 'activeUsers' }, { name: 'eventCount' }],
        dimensionFilter: {
          filter: {
            fieldName: 'eventName',
            stringFilter: { matchType: 'PARTIAL_REGEXP', value: TX_DISCOVERY_REGEX, caseSensitive: false },
          },
        },
        limit: '500',
      },
    })

    const rows = (resp.data.rows ?? []).map((r: analyticsdata_v1beta.Schema$Row) => ({
      eventName: r.dimensionValues?.[0]?.value ?? '',
      platform: r.dimensionValues?.[1]?.value ?? '',
      activeUsers: toNum(r.metricValues?.[0]?.value),
      eventCount: toNum(r.metricValues?.[1]?.value),
    }))
    rows.sort((a: { eventCount: number }, b: { eventCount: number }) => b.eventCount - a.eventCount)

    return NextResponse.json({ window: { startDate, endDate, days }, count: rows.length, rows })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? String(err) })
  }
}
