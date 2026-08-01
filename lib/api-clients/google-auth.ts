/**
 * Shared Google service-account auth for the MRHB Analytics Dashboard.
 *
 * All Google data sources the dashboard syncs from — Google Analytics 4
 * (lib/api-clients/google-analytics.ts), Google Search Console
 * (lib/api-clients/search-console.ts), and Google Play (Android Publisher API
 * for reviews + Play Developer Reporting API for vitals, see
 * lib/api-clients/play-console.ts / play-reviews.ts) — authenticate as the
 * same service account, so the JWT client is built once here and reused.
 *
 * Server-only: reads GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY from
 * process.env, which are never exposed to the browser (no NEXT_PUBLIC_
 * prefix). Do not import this module from a 'use client' component.
 */

import { google } from 'googleapis'

/**
 * OAuth scopes requested for the shared service-account JWT.
 * - analytics.readonly: read GA4 report data via the Analytics Data API.
 * - webmasters.readonly: read Search Console performance data.
 * - androidpublisher: read Play Store reviews/ratings via the Android
 *   Publisher API (requires that API enabled in the GCP project + the service
 *   account added in Play Console).
 * - playdeveloperreporting: read Play Developer Reporting API metric sets
 *   (app vitals: crash/ANR/error rates, etc.).
 */
const GOOGLE_AUTH_SCOPES = [
  'https://www.googleapis.com/auth/analytics.readonly',
  'https://www.googleapis.com/auth/webmasters.readonly',
  'https://www.googleapis.com/auth/androidpublisher',
  'https://www.googleapis.com/auth/playdeveloperreporting',
]

/**
 * Env vars (from .env.example) that must be `\n`-normalized to build the JWT.
 * GOOGLE_PRIVATE_KEY is a PEM string; when it's stored as a single-line env
 * var (e.g. in Vercel or a `.env` file), literal backslash-n sequences stand
 * in for real newlines and must be converted back before the crypto layer
 * can parse the key.
 */
function normalizePrivateKey(rawKey: string): string {
  return rawKey.replace(/\\n/g, '\n')
}

/**
 * Lazily constructs (and memoizes) the shared `google.auth.JWT` client used
 * by all Google API clients in this dashboard.
 *
 * Returns `null` — rather than throwing — when the required service-account
 * env vars are missing, so callers can warn and degrade gracefully (e.g.
 * return an empty result set) instead of crashing a page render or cron job.
 */
export function getGoogleAuth(): InstanceType<typeof google.auth.JWT> | null {
  if (cachedAuth) {
    return cachedAuth
  }

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const rawPrivateKey = process.env.GOOGLE_PRIVATE_KEY

  if (!email || !rawPrivateKey) {
    console.warn(
      '[google-auth] Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY ' +
        'env vars — Google API clients (GA4, Search Console, Play) will be skipped.'
    )
    return null
  }

  const privateKey = normalizePrivateKey(rawPrivateKey)

  cachedAuth = new google.auth.JWT({
    email,
    key: privateKey,
    scopes: GOOGLE_AUTH_SCOPES,
  })

  return cachedAuth
}

/** Module-level memoization so repeated calls reuse one JWT client/token cache. */
let cachedAuth: InstanceType<typeof google.auth.JWT> | null = null

/**
 * The shared auth instance, exported directly for callers that want to skip
 * the getter (e.g. quick scripts). Prefer {@link getGoogleAuth} in
 * production code paths since it re-validates env vars on every call and
 * returns `null` cleanly when they're absent — this export is `null` if env
 * vars weren't set at module-load time.
 */
export const googleAuth = getGoogleAuth()
