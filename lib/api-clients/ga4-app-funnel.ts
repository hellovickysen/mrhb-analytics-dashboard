/**
 * New-user onboarding funnel + rate-card inputs for the Sahal Wallet Firebase
 * GA4 app property (GA4_APP_PROPERTY_ID) — Android & iOS only.
 *
 * DEFINITION: PERIOD-WIDE UNIQUE users. Each value is the de-duplicated count
 * of distinct users who fired ANY of the relevant events over the whole
 * [startDate, endDate] window — one person counted once for the period,
 * regardless of how many days or how many qualifying events they triggered.
 * This matches a GA4 Explore "Total" (Active users by Event name, no Date
 * dimension), so a manager cross-checking in GA4 gets the same number.
 *
 * HOW: GA4's `activeUsers` is de-duplicated and NON-additive. Running a report
 * with NO date dimension (metric + eventName filter) returns one correctly
 * de-duplicated period total — the same approach as fetchGA4AppActiveUsersTotal.
 * Never add a date dimension and sum the days (that over-counts multi-day
 * users), and never sum GA4 `users` across event-name rows in `ga_events`
 * (that over-counts users who fire more than one matching event).
 *
 * PLATFORM SCOPE — Android & iOS. Event names encode platform+type in a 3-char
 * prefix: E (event) or S (screen), then A (Android) or I (iOS). The `^[ES][AI]_`
 * gate keeps Android+iOS and excludes web (EW_/SW_) / extension (EE_/SE_).
 *
 * Server-only module — never import from a 'use client' component. Every
 * exported fetcher returns `null` on missing auth / API failure so callers can
 * fall back gracefully.
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

/** Inputs for the Onboarding Rate and Transaction Rate cards (period-wide unique). */
export interface AppRateInputs {
  /** Distinct users who started a new-user signup path (the funnel top). */
  signupStarted: number
  /** Distinct users who completed onboarding. */
  complete: number
  /** Distinct users who reached the app dashboard. */
  dashboard: number
  /** Distinct users who transacted (send / swap / ramp). */
  tx: number
}

/**
 * eventName PARTIAL_REGEXP filters (case-insensitive). `^[ES][AI]_` = Android
 * or iOS, action or screen. Historical `SCREEN__ANDROID__…` / `__` variants are
 * not covered (they only appear in very old data outside the standard 30/90-day
 * windows); add them here if a long look-back ever needs them.
 */
const SIGNUP_STARTED_REGEX =
  '^[ES][AI]_.*(ONBOARDING_LETS_GO|ONBOARDING_SOCIAL_SIGNUP|ONBOARDING_IMPORT_WALLET)'
const PASSCODE_CREATED_REGEX = '^[ES][AI]_.*SETTINGS_NEW_PASSCODE'
const ONBOARDING_COMPLETE_REGEX = '^[ES][AI]_.*ONBOARDING_GUIDE_COMPLETE'
const APP_DASHBOARD_REGEX = '^[ES][AI]_.*APP_DASHBOARD'

/**
 * Transaction taxonomy (per the dev's schema: a completed transaction is
 * `E{A,I}_SEND_{TYPE}_{protocol}`). `token` is the exact TYPE segment right
 * after `SEND_`; we prefix-match `^E[AI]_SEND_{token}` so it stays Android/iOS
 * and counts completions only (not screen/footer taps).
 *
 * Flip `active` to true to switch a type on — that automatically expands BOTH
 * the Transaction Rate numerator (union of active tokens) AND the per-type
 * breakdown. The 3 inactive rows are waiting on the dev to emit their SEND
 * events (MIRO stake/topup/vote, eSIM, Coinformance).
 */
export interface AppTxType {
  key: string
  label: string
  token: string
  active: boolean
}
export const APP_TRANSACTION_TYPES: AppTxType[] = [
  { key: 'swap', label: 'Swap', token: 'SWAP', active: true },
  { key: 'sahal_stake', label: 'Sahal Stake', token: 'SAHAL_STAKE', active: true },
  { key: 'mrhb_store', label: 'MRHB Store', token: 'MRHB_STORE', active: true },
  { key: 'emplifai', label: 'Emplifai', token: 'EMPLIFAI', active: true },
  { key: 'miro_stake', label: 'MIRO Stake', token: 'MIRO_STAKE', active: false },
  { key: 'miro_topup', label: 'MIRO Topup', token: 'MIRO_TOPUP', active: false },
  { key: 'miro_vote', label: 'MIRO Vote', token: 'MIRO_VOTE', active: false },
  { key: 'esim', label: 'eSIM', token: 'ESIM', active: false },
  { key: 'coinformance', label: 'Coinformance', token: 'COINFORMANCE', active: false },
]
function activeTxTypes(): AppTxType[] {
  return APP_TRANSACTION_TYPES.filter((t) => t.active)
}
function txTypeRegex(token: string): string {
  return '^E[AI]_SEND_' + token
}
// Union of active transaction tokens → the Transaction Rate numerator.
const TRANSACTION_REGEX = '^E[AI]_SEND_(' + activeTxTypes().map((t) => t.token).join('|') + ')'

function toNum(value: string | undefined | null): number {
  if (value === undefined || value === null || value === '') return 0
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/** Builds the app-property analyticsdata client, or null if auth is missing. */
function getAppClient(): { client: analyticsdata_v1beta.Analyticsdata; property: string } | null {
  const auth = getGoogleAuth()
  const propertyId = process.env.GA4_APP_PROPERTY_ID
  if (!auth || !propertyId) {
    console.warn('[ga4-app-funnel] Missing GA4 auth or GA4_APP_PROPERTY_ID — skipped.')
    return null
  }
  const client: analyticsdata_v1beta.Analyticsdata = google.analyticsdata({ version: 'v1beta', auth })
  return { client, property: `properties/${propertyId}` }
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
 * auth/property is missing or any report fails.
 */
export async function fetchGA4AppOnboardingFunnel(
  startDate: string,
  endDate: string
): Promise<AppOnboardingFunnel | null> {
  try {
    const app = getAppClient()
    if (!app) return null
    const { client, property } = app

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

/**
 * Returns period-wide unique-user inputs for the Onboarding Rate and
 * Transaction Rate cards (Android/iOS), or `null` on auth/API failure.
 * Same de-dup method as the funnel — so the rates reconcile with GA4 and no
 * longer over-count users across days or across event families.
 */
export async function fetchGA4AppRateInputs(
  startDate: string,
  endDate: string
): Promise<AppRateInputs | null> {
  try {
    const app = getAppClient()
    if (!app) return null
    const { client, property } = app

    const [signupStarted, complete, dashboard, tx] = await Promise.all([
      periodUniqueActiveUsers(client, property, startDate, endDate, SIGNUP_STARTED_REGEX),
      periodUniqueActiveUsers(client, property, startDate, endDate, ONBOARDING_COMPLETE_REGEX),
      periodUniqueActiveUsers(client, property, startDate, endDate, APP_DASHBOARD_REGEX),
      periodUniqueActiveUsers(client, property, startDate, endDate, TRANSACTION_REGEX),
    ])

    return { signupStarted, complete, dashboard, tx }
  } catch (error) {
    console.error('[ga4-app-funnel] fetchGA4AppRateInputs failed:', error)
    return null
  }
}

/** Period-wide unique transacting users for one transaction type. */
export interface AppTxTypeCount {
  key: string
  label: string
  users: number
}

/**
 * Returns period-wide unique transacting users (Android/iOS) per ACTIVE
 * transaction type — the "Transactions by type" breakdown. `null` on failure.
 * The de-duplicated union across types is the Transaction Rate numerator
 * (fetchGA4AppRateInputs.tx), which is <= the sum of these per-type counts.
 */
export async function fetchGA4AppTransactionsByType(
  startDate: string,
  endDate: string
): Promise<AppTxTypeCount[] | null> {
  try {
    const app = getAppClient()
    if (!app) return null
    const { client, property } = app

    const types = activeTxTypes()
    const counts = await Promise.all(
      types.map((t) => periodUniqueActiveUsers(client, property, startDate, endDate, txTypeRegex(t.token)))
    )
    return types.map((t, i) => ({ key: t.key, label: t.label, users: counts[i] }))
  } catch (error) {
    console.error('[ga4-app-funnel] fetchGA4AppTransactionsByType failed:', error)
    return null
  }
}
