/**
 * TEMPORARY read-only diagnostic: does the service account now have working
 * access to Play data? Builds a JWT WITH the Play scopes (the shared google-auth
 * only has analytics/webmasters) and calls each Play API, reporting the real
 * status/error for each so we can tell scope vs. API-not-enabled vs.
 * metric-not-available vs. no-data. Remove after diagnosis. No writes.
 */
import { NextResponse } from 'next/server'
import { google } from 'googleapis'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const PKG = 'sahal.wallet.app'

function normalizeKey(raw: string): string {
  return raw.replace(/\\n/g, '\n')
}

async function tryReporting(token: string, metricSet: string, body: Record<string, unknown>) {
  const url = `https://playdeveloperreporting.googleapis.com/v1beta1/apps/${PKG}/${metricSet}:query`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const text = await res.text().catch(() => '')
    return { metricSet, status: res.status, ok: res.ok, body: text.slice(0, 600) }
  } catch (e) {
    return { metricSet, status: 0, ok: false, body: e instanceof Error ? e.message : String(e) }
  }
}

export async function GET() {
  const out: any = { ok: true, package: PKG, envPackage: process.env.PLAY_PACKAGE_NAME ?? null }

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const rawKey = process.env.GOOGLE_PRIVATE_KEY
  out.hasCreds = !!email && !!rawKey
  out.serviceAccountEmail = email ?? null
  if (!email || !rawKey) {
    out.ok = false
    return NextResponse.json(out)
  }

  // JWT with the Play scopes (NOT in the shared google-auth).
  const jwt = new google.auth.JWT({
    email,
    key: normalizeKey(rawKey),
    scopes: [
      'https://www.googleapis.com/auth/playdeveloperreporting',
      'https://www.googleapis.com/auth/androidpublisher',
    ],
  })

  let token = ''
  try {
    const t = await jwt.getAccessToken()
    token = t.token ?? ''
    out.gotToken = !!token
  } catch (e) {
    out.gotToken = false
    out.tokenError = e instanceof Error ? e.message : String(e)
    return NextResponse.json(out)
  }

  const now = new Date()
  const start = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000)
  const tp = (d: Date) => ({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() })
  const timelineSpec = { aggregationPeriod: 'DAILY', startTime: tp(start), endTime: tp(now) }

  // 1) installs (speculative metric set), 2) store performance (speculative),
  // 3) crashRate (a REAL metric set — control: proves scope + API enablement).
  out.reporting = []
  out.reporting.push(await tryReporting(token, 'installMetricSet', { timelineSpec, dimensions: ['country'], metrics: ['installs', 'uninstalls', 'activeDevices'], pageSize: 5 }))
  out.reporting.push(await tryReporting(token, 'storePerformanceMetricSet', { timelineSpec, dimensions: ['country'], metrics: ['impressions', 'listingVisitors', 'installers'], pageSize: 5 }))
  out.reporting.push(await tryReporting(token, 'crashRateMetricSet', { timelineSpec, metrics: ['crashRate'], pageSize: 5 }))

  // 4) androidpublisher reviews.list — needs androidpublisher scope + permission.
  try {
    const pub = google.androidpublisher({ version: 'v3', auth: jwt })
    const res = await pub.reviews.list({ packageName: PKG, maxResults: 5 })
    out.reviews = { ok: true, count: (res.data.reviews ?? []).length }
  } catch (e: any) {
    out.reviews = { ok: false, status: e?.code ?? e?.response?.status ?? null, error: (e?.message ?? String(e)).slice(0, 400) }
  }

  return NextResponse.json(out)
}
