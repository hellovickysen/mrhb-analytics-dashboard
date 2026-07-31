/**
 * Short.io API client for the MRHB Analytics Dashboard.
 *
 * Uses two different base URLs (per Short.io docs at developers.short.io):
 *   - https://api.short.io       — for links and domain management
 *   - https://statistics.short.io — for click statistics
 *
 * Auth: Authorization header with raw API key (no Bearer prefix).
 * Requires a SECRET API key — public keys cannot access statistics.
 *
 * Env vars:
 *   - SHORTIO_API_KEY  — Secret API key
 *   - SHORTIO_DOMAIN   — e.g. "mrhbnetwork.short.gy"
 */

const API_BASE = 'https://api.short.io'
const STATS_BASE = 'https://statistics.short.io'

function getApiKey(): string | null {
  const key = process.env.SHORTIO_API_KEY
  if (!key) {
    console.warn('[shortio] Missing SHORTIO_API_KEY env var — Short.io fetch skipped.')
    return null
  }
  return key
}

function getDomain(): string | null {
  const domain = process.env.SHORTIO_DOMAIN
  if (!domain) {
    console.warn('[shortio] Missing SHORTIO_DOMAIN env var — Short.io fetch skipped.')
    return null
  }
  return domain
}

async function shortioFetch(url: string, apiKey: string): Promise<any> {
  const res = await fetch(url, {
    headers: {
      'Authorization': apiKey,
      'Accept': 'application/json',
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Short.io API error ${res.status}: ${text}`)
  }
  return res.json()
}

// ---------------------------------------------------------------------------
// Discover domainId from domain hostname
// ---------------------------------------------------------------------------

let _cachedDomainId: number | null = null

async function getDomainId(apiKey: string, domain: string): Promise<number | null> {
  if (_cachedDomainId) return _cachedDomainId

  try {
    const data = await shortioFetch(`${API_BASE}/api/domains`, apiKey)
    // API may return a single object, an array, or { list: [...] }
    const domains: any[] = Array.isArray(data)
      ? data
      : Array.isArray(data?.list)
        ? data.list
        : data?.id
          ? [data]
          : []
    const found = domains.find(
      (d: any) => d.hostname === domain || d.hostname === domain.toLowerCase()
    )
    if (!found) {
      console.warn(`[shortio] Domain "${domain}" not found in ${domains.length} domains. Available: ${domains.map((d: any) => d.hostname).join(', ')}`)
      return null
    }
    _cachedDomainId = found.id
    console.log(`[shortio] Resolved domain "${domain}" to id ${found.id}`)
    return found.id
  } catch (error) {
    console.error('[shortio] Failed to discover domainId:', error)
    return null
  }
}

// ---------------------------------------------------------------------------
// Fetch links
// ---------------------------------------------------------------------------

export interface ShortIOLink {
  link_id: string
  short_url: string
  original_url: string
  title: string
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  created_at: string
}

export async function fetchShortIOLinks(): Promise<Omit<ShortIOLink, 'id'>[]> {
  try {
    const apiKey = getApiKey()
    const domain = getDomain()
    if (!apiKey || !domain) return []

    const domainId = await getDomainId(apiKey, domain)
    if (!domainId) return []

    const data = await shortioFetch(
      `${API_BASE}/api/links?domain_id=${domainId}&limit=150`,
      apiKey
    )

    const links = Array.isArray(data?.links) ? data.links : Array.isArray(data) ? data : []

    return links.map((link: any): Omit<ShortIOLink, 'id'> => {
      let utmSource: string | null = null
      let utmMedium: string | null = null
      let utmCampaign: string | null = null
      try {
        const url = new URL(link.originalURL || link.secureOriginalURL || '')
        utmSource = url.searchParams.get('utm_source')
        utmMedium = url.searchParams.get('utm_medium')
        utmCampaign = url.searchParams.get('utm_campaign')
      } catch {}

      return {
        link_id: String(link.idString || link.id || ''),
        short_url: `https://${domain}/${link.path || ''}`,
        original_url: link.originalURL || link.secureOriginalURL || '',
        title: link.title || link.path || '',
        utm_source: utmSource,
        utm_medium: utmMedium,
        utm_campaign: utmCampaign,
        created_at: link.createdAt || new Date().toISOString(),
      }
    })
  } catch (error) {
    console.error('[shortio] fetchShortIOLinks failed:', error)
    return []
  }
}

// ---------------------------------------------------------------------------
// Fetch domain statistics — single API call returns everything
// ---------------------------------------------------------------------------

export async function fetchAllShortIOData(
  startDate: string,
  endDate: string
): Promise<{
  links: Omit<ShortIOLink, 'id'>[]
  clicks: Record<string, any>[]
}> {
  try {
    const apiKey = getApiKey()
    const domain = getDomain()
    if (!apiKey || !domain) return { links: [], clicks: [] }

    const domainId = await getDomainId(apiKey, domain)
    if (!domainId) return { links: [], clicks: [] }

    // Fetch links and domain stats in parallel
    const [links, stats] = await Promise.all([
      fetchShortIOLinks(),
      (async () => {
        const params = new URLSearchParams({
          period: 'custom',
          startDate,
          endDate,
          clicksChartInterval: 'day',
          tz: 'UTC',
        })
        return shortioFetch(
          `${STATS_BASE}/statistics/domain/${domainId}?${params}`,
          apiKey
        )
      })(),
    ])

    const clickRows: Record<string, any>[] = []
    const today = new Date().toISOString().slice(0, 10)

    // Calculate human click ratio for estimating daily human clicks.
    // The Short.io API only gives human clicks as a period total, not
    // per-day. We distribute proportionally across daily rows so the
    // date range picker works correctly.
    const totalClicks = stats.clicks || 1
    const totalHuman = stats.humanClicks || 0
    const humanRatio = totalHuman / totalClicks

    // Overwrite any old domain_total row with human_clicks=0 so it doesn't
    // inflate date-range queries. Human clicks are now in daily rows instead.
    clickRows.push({
      date: today,
      link_id: 'domain_total',
      total_clicks: stats.clicks || 0,
      human_clicks: 0,
      country: 'ALL',
      city: 'ALL',
      os: 'ALL',
      browser: 'ALL',
      referrer: 'ALL',
    })

    // Country breakdown rows — unique link_id per dimension type
    if (Array.isArray(stats.country)) {
      for (const c of stats.country) {
        const countryName = c.countryName || c.country || 'Unknown'
        clickRows.push({
          date: today,
          link_id: 'by_country',
          total_clicks: c.score || 0,
          human_clicks: 0,
          country: countryName,
          city: countryName,
          os: 'ALL',
          browser: 'ALL',
          referrer: 'ALL',
        })
      }
    }

    // Referrer breakdown rows
    if (Array.isArray(stats.referer)) {
      for (const r of stats.referer) {
        const ref = r.refhost || r.referer || 'Unknown'
        clickRows.push({
          date: today,
          link_id: 'by_referrer',
          total_clicks: r.score || 0,
          human_clicks: 0,
          country: 'ALL',
          city: 'ALL',
          os: 'ALL',
          browser: 'ALL',
          referrer: ref,
        })
      }
    }

    // Social platform breakdown
    if (Array.isArray(stats.social)) {
      for (const s of stats.social) {
        clickRows.push({
          date: today,
          link_id: 'by_social',
          total_clicks: s.score || 0,
          human_clicks: 0,
          country: 'ALL',
          city: 'ALL',
          os: 'ALL',
          browser: 'ALL',
          referrer: s.social || 'Unknown',
        })
      }
    }

    // OS breakdown rows
    if (Array.isArray(stats.os)) {
      for (const o of stats.os) {
        clickRows.push({
          date: today,
          link_id: 'by_os',
          total_clicks: o.score || 0,
          human_clicks: 0,
          country: 'ALL',
          city: 'ALL',
          os: o.os || 'Unknown',
          browser: 'ALL',
          referrer: 'ALL',
        })
      }
    }

    // Browser breakdown rows
    if (Array.isArray(stats.browser)) {
      for (const b of stats.browser) {
        clickRows.push({
          date: today,
          link_id: 'by_browser',
          total_clicks: b.score || 0,
          human_clicks: 0,
          country: 'ALL',
          city: 'ALL',
          os: 'ALL',
          browser: b.browser || 'Unknown',
          referrer: 'ALL',
        })
      }
    }

    // Daily time-series rows — PRIMARY data source for date-range queries.
    // Short.io returns clickStatistics.datasets[0].data as an array of
    // { x: ISO-date, y: <clicks> } points. Two source facts drive this logic:
    //
    //   1. `y` is a NUMERIC STRING (e.g. "6"), not a number. Coerce with
    //      Number() — a strict `typeof y === 'number'` check silently drops
    //      every point, leaving zero domain_daily rows (the Social page then
    //      falls back to mock data).
    //
    //   2. This daily chart is a SHAPE series only: its values do NOT sum to
    //      the authoritative period totals. Empirically, for a window whose
    //      stats.clicks=1202 / stats.humanClicks=261, the daily series summed
    //      to just 139. Using the raw daily value as the day's total clicks
    //      therefore understates totals AND makes distributed human clicks
    //      exceed them (a >100% human rate).
    //
    // So we treat the daily points purely as WEIGHTS and allocate the real
    // period totals (stats.clicks and stats.humanClicks) across the days,
    // with a final-day remainder correction so the domain_daily rows sum
    // EXACTLY to stats.clicks (total) and stats.humanClicks (human). Because
    // both series use the same weights and totalClicks >= totalHuman, every
    // day keeps total_clicks >= human_clicks (no per-day rate above 100%).
    const rawDailyPoints = stats.clickStatistics?.datasets?.[0]?.data
    if (Array.isArray(rawDailyPoints)) {
      const dailyPoints = rawDailyPoints
        .map((p: any) => ({ x: p?.x, y: Number(p?.y) }))
        .filter((p: { x: any; y: number }) => p.x && Number.isFinite(p.y))

      const weightSum = dailyPoints.reduce((s: number, p: { y: number }) => s + p.y, 0)
      const n = dailyPoints.length
      const denom = weightSum > 0 ? weightSum : n || 1

      // Cumulative-rounding allocation: walk the days accumulating weight and
      // set each day's total to round(cumFraction * periodTotal) minus what's
      // already been allocated. The final day's cumulative fraction is 1, so
      // the rounded cumulative equals the exact period total — the daily rows
      // sum EXACTLY to stats.clicks / stats.humanClicks with no drift, and a
      // trailing zero-click day (e.g. "today") correctly receives 0.
      let cumWeight = 0
      let allocTotal = 0
      let allocHuman = 0

      for (let i = 0; i < n; i++) {
        const point = dailyPoints[i]
        const dateStr = String(point.x).slice(0, 10)
        cumWeight += weightSum > 0 ? point.y : 1
        const frac = cumWeight / denom

        const targetTotal = Math.round(frac * totalClicks)
        const targetHuman = Math.round(frac * totalHuman)
        const dailyTotal = targetTotal - allocTotal
        const dailyHuman = targetHuman - allocHuman
        allocTotal = targetTotal
        allocHuman = targetHuman

        if (dateStr) {
          clickRows.push({
            date: dateStr,
            link_id: 'domain_daily',
            total_clicks: Math.max(0, dailyTotal),
            human_clicks: Math.max(0, dailyHuman),
            country: 'ALL',
            city: 'ALL',
            os: 'ALL',
            browser: 'ALL',
            referrer: 'ALL',
          })
        }
      }
    }

    console.log(`[shortio] Fetched ${links.length} links, ${stats.clicks || 0} total clicks, ${stats.humanClicks || 0} human clicks, ${clickRows.length} click rows`)

    return { links, clicks: clickRows }
  } catch (error) {
    console.error('[shortio] fetchAllShortIOData failed:', error)
    return { links: [], clicks: [] }
  }
}
