/** TEMPORARY: verify Android Publisher reviews.list works after enabling the
 * API + adding the androidpublisher scope. Remove after verification. */
import { NextResponse } from 'next/server'
import { fetchRecentPlayReviews } from '@/lib/api-clients/play-reviews'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  const r = await fetchRecentPlayReviews(2)
  return NextResponse.json({
    sourced: r.sourced,
    sampledCount: r.sampledCount,
    avgSampled: r.avgSampled,
    distribution: r.distribution,
    sample: r.reviews.slice(0, 3),
  })
}
