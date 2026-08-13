import { NextResponse } from 'next/server'
import { google, type analyticsdata_v1beta } from 'googleapis'
import { getGoogleAuth } from '@/lib/api-clients/google-auth'

// TEMPORARY read-only verification route — queries the Firebase GA4 app
// property directly to establish (a) the platform dimension of the EW_
// onboarding events and (b) the corrected daily-unique funnel numbers.
// DELETE after reading.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function toNum(v: string | undefined | null): number {
  if (v === undefined || v === null || v === '') return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

const SIGNUP_TOKENS = '(ONBOARDING_LETS_GO|ONBOARDING_SOCIAL_SIGNUP|ONBOARDING_IMPORT_WALLET)'
const COMPLETE_TOKEN = 'ONBOARDING_GUIDE_COMPLETE'
const PASSCODE_TOKEN = 'SETTINGS_NEW_PASSCODE'
const ALL_TOKENS =
  '(ONBOARDING_LETS_GO|ONBOARDING_SOCIAL_SIGNUP|ONBOARDING_IMPORT_WALLET|ONBOARDING_GUIDE_COMPLETE|SETTINGS_NEW_PASSCODE)'

export async function GET(request: Request) {
  try {
    const auth = getGoogleAuth()
    const propertyId = process.env.GA4_APP_PROPERTY_ID
    if (!auth || !propertyId) {
      return NextResponse.json({ error: 'Missing GA4 auth or GA4_APP_PROPERTY_ID' })
    }
    const client: analyticsdata_v1beta.Analyticsdata = google.analyticsdata({ version: 'v1beta', auth })
    const property = `properties/${propertyId}`

    const url = new URL(request.url)
    const days = Math.min(120, Math.max(1, Number(url.searchParams.get('days')) || 30))
    const now = new Date()
    const startDate = fmtDate(new Date(now.getTime() - days * 86400000))
    const endDate = fmtDate(now)

    // A) eventName x platform breakdown for all onboarding/passcode tokens.
    const respA = await client.properties.runReport({
      property,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'eventName' }, { name: 'platform' }],
        metrics: [{ name: 'activeUsers' }, { name: 'eventCount' }],
        dimensionFilter: {
          filter: {
            fieldName: 'eventName',
            stringFilter: { matchType: 'PARTIAL_REGEXP', value: ALL_TOKENS, caseSensitive: false },
          },
        },
        limit: '1000',
      },
    })
    const eventPlatform = (respA.data.rows ?? []).map((r: analyticsdata_v1beta.Schema$Row) => ({
      eventName: r.dimensionValues?.[0]?.value ?? '',
      platform: r.dimensionValues?.[1]?.value ?? '',
      activeUsers: toNum(r.metricValues?.[0]?.value),
      eventCount: toNum(r.metricValues?.[1]?.value),
    }))

    // Helper: per-day activeUsers, summed, for an eventName token regex, with
    // an optional platform inList restriction (Android/iOS).
    const dailyUnique = async (tokenRegex: string, restrictPlatform: boolean) => {
      const eventFilter = {
        filter: {
          fieldName: 'eventName',
          stringFilter: { matchType: 'PARTIAL_REGEXP', value: tokenRegex, caseSensitive: false },
        },
      }
      const platformFilter = {
        filter: {
          fieldName: 'platform',
          inListFilter: { values: ['Android', 'iOS'], caseSensitive: false },
        },
      }
      const dimensionFilter = restrictPlatform
        ? { andGroup: { expressions: [eventFilter, platformFilter] } }
        : eventFilter
      const resp = await client.properties.runReport({
        property,
        requestBody: {
          dateRanges: [{ startDate, endDate }],
          dimensions: [{ name: 'date' }],
          metrics: [{ name: 'activeUsers' }],
          dimensionFilter,
          limit: '100000',
        },
      })
      const perDay = (resp.data.rows ?? []).map((r: analyticsdata_v1beta.Schema$Row) => ({
        date: r.dimensionValues?.[0]?.value ?? '',
        activeUsers: toNum(r.metricValues?.[0]?.value),
      }))
      const sum = perDay.reduce((s: number, d: { date: string; activeUsers: number }) => s + d.activeUsers, 0)
      return { sum, perDay }
    }

    const signupAllPlatforms = await dailyUnique(SIGNUP_TOKENS, false)
    const signupAndroidIos = await dailyUnique(SIGNUP_TOKENS, true)
    const passcodeAllPlatforms = await dailyUnique(PASSCODE_TOKEN, false)
    const passcodeAndroidIos = await dailyUnique(PASSCODE_TOKEN, true)
    const completeAllPlatforms = await dailyUnique(COMPLETE_TOKEN, false)
    const completeAndroidIos = await dailyUnique(COMPLETE_TOKEN, true)

    return NextResponse.json({
      window: { startDate, endDate, days },
      note: 'A) shows the platform dimension of the EW_ onboarding events. Compare *_allPlatforms vs *_androidIos sums: if equal, the events are already Android/iOS only; if allPlatforms > androidIos, some are web/other.',
      eventPlatform,
      funnelDailyUnique: {
        signup: { allPlatforms: signupAllPlatforms.sum, androidIos: signupAndroidIos.sum },
        passcode: { allPlatforms: passcodeAllPlatforms.sum, androidIos: passcodeAndroidIos.sum },
        complete: { allPlatforms: completeAllPlatforms.sum, androidIos: completeAndroidIos.sum },
      },
      signupPerDay_allPlatforms: signupAllPlatforms.perDay,
      signupPerDay_androidIos: signupAndroidIos.perDay,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? String(err) })
  }
}
