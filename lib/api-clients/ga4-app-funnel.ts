/**
 * New-user onboarding funnel counts for the Sahal Wallet Firebase GA4 app
 * property (GA4_APP_PROPERTY_ID) — Android & iOS only.
 *
 * DEFINITION: PERIOD-WIDE UNIQUE users per stage. Each stage value is the
 * de-duplicated count of distinct users who fired ANY of that stage's events
 * over the whole [startDate, endDate] window — i.e. one person is counted once
 * for the period, no matter how many days or how many qualifying events they
 * triggered. This matches what a GA4 Explore report shows in its "Total" row
 * when Active users is the metric and Event name is the row dimension (no Date
 * dimension), so a manager cross-checking in GA4 gets the same number.
 *
 * HOW: GA4's `activeUsers` is a de-duplicated, NON-additive metric. Running a
 * report with NO date dimension (just the metric + an eventName filter) returns
 * a single correctly de-duplicated period total — the same approach used by
 * fetchGA4AppActiveUsersTotal for the Active Users KPI. (Do NOT add a date
 * dimension and sum the days — that would produce a daily-summed CEILING that
 * over-counts anyone active on multiple days.)
 *
 * WHY NOT ga_events: the stored ga_events table is at (date, event_name) grain
 * with NO user identifier, so the union of distinct users across Let's Go /
 * Social Signup / Import Wallet cannot be recovered from it — summing its
 * per-event `users` rows double-counts a person who triggered more than one
 * path. GA4 must be queried directly.
 *
 * PLATFORM SCOPE — Android & iOS only. Event names encode platform+type in a
 * 3-char prefix: first char E (event/action) or S (screen), second char A
 * (Android) or I (iOS), then `_`. The regex gate `^[ES][AI]_` keeps Android +
 * iOS (action and screen forms — the passcode step is a native SA_/SI_ screen)
 * and excludes web (EW_/SW_) and extension (EE_/SE_). GA4's user
 * de-duplication means matching both the action and screen form of the same
 * step never double-counts a user.
 *
 * Server-only module — never import from a 'use client' component. Returns
 * `null` on missing auth / API failure so callers can fall back gracefully.
 */

import { google, type analyticsdata_v1beta } from 'googleapis'
import { getGoogleAuth } from './google-auth'

export interface AppOnboardingFunnel {
  /** Period-wide distinct users who started a new-user signup path. */
  signupStarted: number
  /** Period-wide distinct users who created a new passcode. */
  passcodeCreated: number
  /** Period-wide distinct users who completed onboarding. */
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
 * Runs a GA4 report with NO date dimension (activeUsers metric + an eventName
 * regex filter) and returns the single de-duplicated period-wide unique-user
 * total for the events matching the filter.
 */
async function periodUniqueActiveUsers(
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
    },
  })
  return toNum(resp.data.rows?.[0]?.metricValues?.[0]?.value)
}

/**
 * Returns the Android/iOS onboarding funnel (period-wide unique users per
 * stage) over the inclusive [startDate, endDate] GA4 window, or `null` if
 * auth/property is missing or any report fails (so the caller can fall back
 * to its existing figures).
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
      periodUniqueActiveUsers(client, property, startDate, endDate, SIGNUP_STARTED_REGEX),
      periodUniqueActiveUsers(client, property, startDate, endDate, PASSCODE_CREATED_REGEX),
      periodUniqueActiveUsers(client, property, startDate, endDate, ONBOARDING_COMPLETE_REGEX),
    ])

    return { signupStarted, passcodeCreated, onboardingComplete }
  } catch (error) {
    console.error('[ga4-app-funnel] fetchGA4AppOnboardingFunnel failed:', error)
    return null
  }
}
