/**
 * De-duplicated TOTAL active users for the Sahal Wallet Firebase GA4 app
 * property (GA4_APP_PROPERTY_ID) over a [startDate, endDate] window.
 *
 * WHY THIS EXISTS
 * The Overview page previously computed "Wallet Active Users" by SUMMING the
 * per-day `activeUsers` values from fetchGA4AppActiveUsers(). GA4's activeUsers
 * is a DE-DUPLICATED, NON-additive metric — a user active on 10 days counts
 * once for the period but 10 times in a daily sum — so that overcounted the
 * true period figure. This helper issues a single runReport with NO date
 * dimension, so GA4 returns one correctly de-duplicated period total.
 *
 * Server-only module — never import from a 'use client' component.
 */

import { google, type analyticsdata_v1beta } from 'googleapis'
import { getGoogleAuth } from './google-auth'

function toNum(value: string | undefined | null): number {
  if (value === undefined || value === null || value === '') return 0
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/**
 * Returns the de-duplicated active-user count for the app property over the
 * inclusive [startDate, endDate] window (GA4 date semantics). Returns 0 if
 * auth/property is missing or the call fails, so callers can fall back.
 */
export async function fetchGA4AppActiveUsersTotal(
  startDate: string,
  endDate: string
): Promise<number> {
  try {
    const auth = getGoogleAuth()
    const propertyId = process.env.GA4_APP_PROPERTY_ID
    if (!auth || !propertyId) {
      console.warn('[ga4-app-active-total] Missing GA4 auth or GA4_APP_PROPERTY_ID — skipped.')
      return 0
    }
    const client: analyticsdata_v1beta.Analyticsdata = google.analyticsdata({ version: 'v1beta', auth })
    const resp = await client.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        metrics: [{ name: 'activeUsers' }],
      },
    })
    return toNum(resp.data.rows?.[0]?.metricValues?.[0]?.value)
  } catch (error) {
    console.error('[ga4-app-active-total] fetchGA4AppActiveUsersTotal failed:', error)
    return 0
  }
}
