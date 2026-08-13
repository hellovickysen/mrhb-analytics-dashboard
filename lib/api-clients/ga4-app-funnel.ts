/**
 * New-user onboarding funnel counts for the Sahal Wallet Firebase GA4 app
 * property (GA4_APP_PROPERTY_ID), computed the CORRECT way: per-day
 * de-duplicated users, summed across the range — Android & iOS only.
 *
 * WHY THIS EXISTS
 * The App Performance funnel previously derived "Started signup" by SUMMING
 * the per-event `ga_events.users` rows for every qualifying signup event
 * (Let's Go + each Social Signup provider + Import Wallet). Because a single
 * user can trigger more than one of those events on the same day, that sum
 * double-counts people: 20 Let's Go + 5 Google + 3 Twitter + 4 Import Wallet
 * became 32 even when only 23 distinct users signed up that day.
 *
 * `ga_events` is stored at (date, event_name) grain with NO user identifier,
 * so the union of users across those event names cannot be recovered from it.
 * The only correct source is GA4 itself, queried with:
 *   - dimension: `date` ONLY (no eventName breakdown — that is what forces GA4
 *     to de-duplicate a user across every matching event within the day),
 *   - metric: `activeUsers` (GA4's de-duplicated user metric),
 *   - a dimensionFilter restricting `eventName` to the OR-union of the stage's
 *     qualifying events, Android/iOS only.
 * Each day's `activeUsers` is then the distinct users who fired ANY qualifying
 * event that day; the funnel value is the SUM of those daily distinct counts.
 *
 * This is intentionally a daily-summed CEILING, not a period-wide unique count:
 * a person who signs up on two different days counts on each day, by design.
 * That is why a daily-summed total (e.g. 330) can legitimately exceed GA4's
 * period-wide unique total (e.g. 195).
 *
 * PLATFORM SCOPE — Android & iOS only. Event names encode platform+type in a
 * 3-char prefix: first char E (event/action) or S (screen), second char A
 * (Android) or I (iOS), then `_`. The regex gate `^[ES][AI]_` therefore keeps
 * Android + iOS (action and screen forms) and excludes web (EW_/SW_) and
 * extension (EE_/SE_). GA4's user de-duplication means matching both the
 * action and screen form of the same step never double-counts a user.
 *
 * Server-only module — never import from a 'use client' component. Returns
 * `null` on missing auth / API failure so callers can fall back gracefully.
 */

import { google, type analyticsdata_v1beta } from 'googleapis'
import { getGoogleAuth } from './google-auth'

export interface AppOnboardingFunnel {
  /** Sum of daily distinct users who started a new-user signup path. */
  signupStarted: number
  /** Sum of daily distinct users who created a new passcode. */
  passcodeCreated: number
  /** Sum of daily distinct users who completed onboarding. */
  onboardingComplete: number
}

/**
 * eventName PARTIAL_REGEXP filters (case-insensitive). `^[ES][AI]_` = Android
 * or iOS, action or screen. Historical `SCREEN__ANDROID__…` / `__` variants
 * are not covered (they only appear in very old data outside the standard
 * 30/90-day windows); add them here if a long look-back ever needs them.
 */
const SIGNUP_STARTED_REGEX =
  '^[ES][AI]_.*(ONBOARDING_LETS_GO|ONBOARDING_SOCIAL_SIGNUP|ONBOARDING_IMPORT_WALLET)'
const PASSCODE_CREATED_REGEX = '^[ES][AI]_.*SETTINGS_NEW_PASSCODE'
const ONBOARDING_COMPLETE_REGEX = '^[ES][AI]_.*ONBOARDING_GUIDE_COMPLETE'

function toNum(value: string | undefined | null): number {
  if (value === undefined || value === null || value === '') return 0
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/**
 * Runs a single GA4 report (date dimension, activeUsers metric, eventName
 * regex filter) and returns the SUM of the daily de-duplicated user counts.
 * At most ~90 rows for a 90-day window, so a single request suffices.
 */
async function sumDailyActiveUsers(
  client: analyticsdata_v1beta.Analyticsdata,
  property: string,
  startDate: string,
  endDate: string,
  eventNameRegex: string
): Promise<number> {
  const resp = await client.properties.runReport({
    property,
    requestBody: {
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'date' }],
      metrics: [{ name: 'activeUsers' }],
      dimensionFilter: {
        filter: {
          fieldName: 'eventName',
          stringFilter: {
            matchType: 'PARTIAL_REGEXP',
            value: eventNameRegex,
            caseSensitive: false,
          },
        },
      },
      limit: '100000',
    },
  })
  const rows = resp.data.rows ?? []
  return rows.reduce((sum, row) => sum + toNum(row.metricValues?.[0]?.value), 0)
}

/**
 * Returns the Android/iOS onboarding funnel over the inclusive
 * [startDate, endDate] GA4 window, or `null` if auth/property is missing or
 * any report fails (so the caller can fall back to its existing figures).
 */
export async function fetchGA4AppOnboardingFunnel(
  startDate: string,
  endDate: string
): Promise<AppOnboardingFunnel | null> {
  try {
    const auth = getGoogleAuth()
    const propertyId = process.env.GA4_APP_PROPERTY_ID
    if (!auth || !propertyId) {
      console.warn('[ga4-app-funnel] Missing GA4 auth or GA4_APP_PROPERTY_ID — skipped.')
      return null
    }
    const client: analyticsdata_v1beta.Analyticsdata = google.analyticsdata({ version: 'v1beta', auth })
    const property = `properties/${propertyId}`

    const [signupStarted, passcodeCreated, onboardingComplete] = await Promise.all([
      sumDailyActiveUsers(client, property, startDate, endDate, SIGNUP_STARTED_REGEX),
      sumDailyActiveUsers(client, property, startDate, endDate, PASSCODE_CREATED_REGEX),
      sumDailyActiveUsers(client, property, startDate, endDate, ONBOARDING_COMPLETE_REGEX),
    ])

    return { signupStarted, passcodeCreated, onboardingComplete }
  } catch (error) {
    console.error('[ga4-app-funnel] fetchGA4AppOnboardingFunnel failed:', error)
    return null
  }
}
