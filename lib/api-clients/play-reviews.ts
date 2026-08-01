/**
 * Recent Play Store reviews via the Android Publisher API (reviews.list).
 *
 * IMPORTANT: reviews.list only returns a bounded, recent window of reviews
 * that have a written comment (Google caps retrievable history — it is NOT the
 * full all-time rating histogram, and rating-only ratings with no comment
 * aren't returned at all). So the star distribution derived here is labelled
 * as a *sample of recent reviews*, and the headline average rating / review
 * count should still come from the store-listing aggregate (play_ratings),
 * which reflects the true all-time number.
 *
 * Requires: Android Publisher API enabled in the GCP project + the service
 * account added in Play Console, and the `androidpublisher` scope on the JWT
 * (see lib/api-clients/google-auth.ts). Server-only.
 */

import { google } from 'googleapis'
import { getGoogleAuth } from './google-auth'

export interface PlayReviewItem {
  author: string
  rating: number
  text: string
  date: string
  version: string | null
  device: string | null
  thumbsUp: number
}

export interface RecentPlayReviews {
  reviews: PlayReviewItem[]
  distribution: { star1: number; star2: number; star3: number; star4: number; star5: number }
  sampledCount: number
  avgSampled: number
  sourced: boolean
}

const EMPTY: RecentPlayReviews = {
  reviews: [],
  distribution: { star1: 0, star2: 0, star3: 0, star4: 0, star5: 0 },
  sampledCount: 0,
  avgSampled: 0,
  sourced: false,
}

function tsToDate(ts: { seconds?: string | number | null } | null | undefined): string {
  if (!ts || ts.seconds === undefined || ts.seconds === null) return ''
  const secs = Number(ts.seconds)
  if (!Number.isFinite(secs)) return ''
  return new Date(secs * 1000).toISOString().slice(0, 10)
}

/**
 * Fetches up to `maxPages` pages (100 reviews each) of the most recent Play
 * reviews and derives a star distribution from the sample. Returns a neutral
 * empty result (sourced:false) on any failure — never throws.
 */
export async function fetchRecentPlayReviews(maxPages = 2): Promise<RecentPlayReviews> {
  try {
    const auth = getGoogleAuth()
    const packageName = process.env.PLAY_PACKAGE_NAME || 'sahal.wallet.app'
    if (!auth) return EMPTY

    const publisher = google.androidpublisher({ version: 'v3', auth })
    const raw: any[] = []
    let token: string | undefined
    let pages = 0
    do {
      const res = await publisher.reviews.list({ packageName, maxResults: 100, token })
      raw.push(...(res.data.reviews ?? []))
      token = res.data.tokenPagination?.nextPageToken ?? undefined
      pages += 1
    } while (token && pages < maxPages)

    const stars = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    let sum = 0
    let cnt = 0
    const items: PlayReviewItem[] = []

    for (const r of raw) {
      const comments = (r.comments ?? []) as any[]
      const uc = comments.length > 0 ? comments[comments.length - 1]?.userComment : undefined
      const rating = uc?.starRating
      if (typeof rating === 'number' && rating >= 1 && rating <= 5) {
        stars[rating as 1 | 2 | 3 | 4 | 5] += 1
        sum += rating
        cnt += 1
      }
      items.push({
        author: r.authorName || 'Anonymous',
        rating: typeof rating === 'number' ? rating : 0,
        text: String(uc?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 280),
        date: tsToDate(uc?.lastModified),
        version: uc?.appVersionName ?? null,
        device: uc?.device ?? null,
        thumbsUp: Number(uc?.thumbsUpCount) || 0,
      })
    }

    // Most-recent first (reviews.list returns newest first already, but sort
    // defensively by date desc where available).
    items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))

    return {
      reviews: items.slice(0, 20),
      distribution: { star1: stars[1], star2: stars[2], star3: stars[3], star4: stars[4], star5: stars[5] },
      sampledCount: cnt,
      avgSampled: cnt > 0 ? Number((sum / cnt).toFixed(2)) : 0,
      sourced: cnt > 0 || items.length > 0,
    }
  } catch (error) {
    console.error('[play-reviews] fetchRecentPlayReviews failed:', error)
    return EMPTY
  }
}
