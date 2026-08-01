/** TEMPORARY: surface the RAW reviews.list result/error to distinguish
 * "0 reviews" from a 403/permission/scope problem. Remove after diagnosis. */
import { NextResponse } from 'next/server'
import { google } from 'googleapis'
import { getGoogleAuth } from '@/lib/api-clients/google-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  const pkg = process.env.PLAY_PACKAGE_NAME || 'sahal.wallet.app'
  const out: any = { package: pkg }
  const auth = getGoogleAuth()
  out.hasAuth = !!auth
  if (!auth) return NextResponse.json(out)
  try {
    const t = await auth.getAccessToken()
    out.gotToken = !!t.token
  } catch (e: any) {
    out.gotToken = false
    out.tokenError = String(e?.message ?? e).slice(0, 300)
  }
  try {
    const pub = google.androidpublisher({ version: 'v3', auth })
    const res = await pub.reviews.list({ packageName: pkg, maxResults: 20 })
    const reviews = res.data.reviews ?? []
    out.ok = true
    out.reviewCount = reviews.length
    out.sample = reviews.slice(0, 2).map((r: any) => {
      const c = r.comments?.[r.comments.length - 1]?.userComment
      return { author: r.authorName, star: c?.starRating, hasText: !!c?.text }
    })
  } catch (e: any) {
    out.ok = false
    out.status = e?.code ?? e?.response?.status ?? null
    out.error = String(e?.message ?? e).slice(0, 500)
  }
  return NextResponse.json(out)
}
