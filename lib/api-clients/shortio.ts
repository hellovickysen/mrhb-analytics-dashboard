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
      `${API_BASE}/links?domain_id=${domainId}&limit=150`,
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

    // Summary row with totals
    clickRows.push({
      date: today,
      link_id: 'domain_total',
      total_clicks: stats.clicks || 0,
      human_clicks: stats.humanClicks || 0,
      country: 'ALL',
      city: '',
      os: '',
      browser: '',
      referrer: '',
    })

    // Country breakdown rows
    if (Array.isArray(stats.country)) {
      for (const c of stats.country) {
        clickRows.push({
          date: today,
          link_id: 'domain_aggregate',
          total_clicks: c.score || 0,
          human_clicks: 0,
          country: c.countryName || c.country || 'Unknown',
          city: '',
          os: '',
          browser: '',
          referrer: '',
        })
      }
    }

    // Referrer breakdown rows
    if (Array.isArray(stats.referer)) {
      for (const r of stats.referer) {
        clickRows.push({
          date: today,
          link_id: 'domain_aggregate',
          total_clicks: r.score || 0,
          human_clicks: 0,
          country: '',
          city: '',
          os: '',
          browser: '',
          referrer: r.referer || 'Unknown',
        })
      }
    }

    // OS breakdown rows
    if (Array.isArray(stats.os)) {
      for (const o of stats.os) {
        clickRows.push({
          date: today,
          link_id: 'domain_aggregate',
          total_clicks: o.score || 0,
          human_clicks: 0,
          country: '',
          city: '',
          os: o.os || 'Unknown',
          browser: '',
          referrer: '',
        })
      }
    }

    // Browser breakdown rows
    if (Array.isArray(stats.browser)) {
      for (const b of stats.browser) {
        clickRows.push({
          date: today,
          link_id: 'domain_aggregate',
          total_clicks: b.score || 0,
          human_clicks: 0,
          country: '',
          city: '',
          os: '',
          browser: b.browser || 'Unknown',
          referrer: '',
        })
      }
    }

    // Daily time-series rows
    if (stats.clickStatistics?.datasets?.[0]?.data) {
      for (const point of stats.clickStatistics.datasets[0].data) {
        const dateStr = (point.x || '').slice(0, 10)
        if (dateStr) {
          clickRows.push({
            date: dateStr,
            link_id: 'domain_daily',
            total_clicks: point.y || 0,
            human_clicks: 0,
            country: '',
            city: '',
            os: '',
            browser: '',
            referrer: '',
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
