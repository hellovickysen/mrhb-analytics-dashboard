import { NextResponse } from 'next/server'
import { google, type analyticsdata_v1beta } from 'googleapis'
import { getGoogleAuth } from '@/lib/api-clients/google-auth'

// TEMPORARY read-only route: confirms the deployed period-wide funnel numbers
// against GA4. DELETE after reading.

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

const SIGNUP = '^[ES][AI]_.*(ONBOARDING_LETS_GO|ONBOARDING_SOCIAL_SIGNUP|ONBOARDING_IMPORT_WALLET)'
const PASSCODE = '^[ES][AI]_.*SETTINGS_NEW_PASSCODE'
const COMPLETE = '^[ES][AI]_.*ONBOARDING_GUIDE_COMPLETE'

export async function GET(request: Request) {
  try {
    const auth = getGoogleAuth()
    const propertyId = process.env.GA4_APP_PROPERTY_ID
    if (!auth || !propertyId) return NextResponse.json({ error: 'Missing GA4 auth or GA4_APP_PROPERTY_ID' })
    const client: analyticsdata_v1beta.Analyticsdata = google.analyticsdata({ version: 'v1beta', auth })
    const property = `properties/${propertyId}`

    const url = new URL(request.url)
    const start = url.searchParams.get('start') || undefined
    const end = url.searchParams.get('end') || undefined
    const days = Math.min(120, Math.max(1, Number(url.searchParams.get('days')) || 30))
    const now = new Date()
    const startDate = start || fmt(new Date(now.getTime() - days * 86400000))
    const endDate = end || fmt(now)

    const periodUnique = async (regex: string) => {
      const resp = await client.properties.runReport({
        property,
        requestBody: {
          dateRanges: [{ startDate, endDate }],
          metrics: [{ name: 'activeUsers' }],
          dimensionFilter: {
            filter: {
              fieldName: 'eventName',
              stringFilter: { matchType: 'PARTIAL_REGEXP', value: regex, caseSensitive: false },
            },
          },
        },
      })
      return toNum(resp.data.rows?.[0]?.metricValues?.[0]?.value)
    }

    const [signup, passcode, complete] = await Promise.all([
      periodUnique(SIGNUP),
      periodUnique(PASSCODE),
      periodUnique(COMPLETE),
    ])

    return NextResponse.json({ window: { startDate, endDate }, periodWideUnique: { signup, passcode, complete } })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? String(err) })
  }
}
