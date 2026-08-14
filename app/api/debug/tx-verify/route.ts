import { NextResponse } from 'next/server'
import { google, type analyticsdata_v1beta } from 'googleapis'
import { getGoogleAuth } from '@/lib/api-clients/google-auth'

// TEMPORARY read-only route: before/after for the transacting-users redefinition.
// DELETE after reading.

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

const OLD_TX = '^[ES][AI]_.*(SEND_MONEY|_SEND_|SWAP|SAHAL_RAMP)'
const NEW_TX_UNION = '^E[AI]_SEND_(SWAP|SAHAL_STAKE|MRHB_STORE|EMPLIFAI)'
const DASHBOARD = '^[ES][AI]_.*APP_DASHBOARD'
const TYPES: Array<{ label: string; regex: string }> = [
  { label: 'Swap', regex: '^E[AI]_SEND_SWAP' },
  { label: 'Sahal Stake', regex: '^E[AI]_SEND_SAHAL_STAKE' },
  { label: 'MRHB Store', regex: '^E[AI]_SEND_MRHB_STORE' },
  { label: 'Emplifai', regex: '^E[AI]_SEND_EMPLIFAI' },
]

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
    const days = Math.min(180, Math.max(1, Number(url.searchParams.get('days')) || 30))
    const now = new Date()
    const startDate = start || fmt(new Date(now.getTime() - days * 86400000))
    const endDate = end || fmt(now)

    const uniq = async (regex: string): Promise<number> => {
      const resp = await client.properties.runReport({
        property,
        requestBody: {
          dateRanges: [{ startDate, endDate }],
          metrics: [{ name: 'activeUsers' }],
          dimensionFilter: {
            filter: { fieldName: 'eventName', stringFilter: { matchType: 'PARTIAL_REGEXP', value: regex, caseSensitive: false } },
          },
        },
      })
      return toNum(resp.data.rows?.[0]?.metricValues?.[0]?.value)
    }

    const [oldTx, newTx, dash] = await Promise.all([uniq(OLD_TX), uniq(NEW_TX_UNION), uniq(DASHBOARD)])
    const byType = await Promise.all(TYPES.map((t) => uniq(t.regex)))
    const pct = (n: number, d: number): number => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0)

    return NextResponse.json({
      window: { startDate, endDate },
      dashboardReachers: dash,
      old: { transactingUsers: oldTx, transactionRate_pct: pct(oldTx, dash) },
      new: { transactingUsers: newTx, transactionRate_pct: pct(newTx, dash) },
      byType: TYPES.map((t, i) => ({ label: t.label, users: byType[i] })),
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? String(err) })
  }
}
