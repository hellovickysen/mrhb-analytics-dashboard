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

// Days of authoritative per-day totals to ingest — drives the 90-day range and
// makes today/yesterday/7d/30d all exact. Fetched via chunked single-day calls.
const DAILY_DAYS = 90
// Fixed reference window for the dimensional breakdown snapshot
// (platform/country/device). Shown on the Social page labelled "last 30 days".
const BREAKDOWN_DAYS = 30
// Max concurrent per-day statistics requests (keeps well within the 120s
// function budget without hammering Short.io).
const DAILY_CONCURRENCY = 10

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

    // Date anchors (UTC — consistent with the dashboard's date-window logic).
    const now = new Date()
    const DAY_MS = 24 * 60 * 60 * 1000
    const iso = (d: Date): string => d.toISOString().slice(0, 10)
    const today = iso(now)
    const tomorrow = iso(new Date(now.getTime() + DAY_MS))
    const breakdownStart = iso(new Date(now.getTime() - BREAKDOWN_DAYS * DAY_MS))

    // Fetch the link registry plus one period-statistics call over the fixed
    // last-30-days reference window (inclusive of today, since endDate is
    // exclusive). This provides the authoritative period total (domain_total,
    // read by the funnel's Social Discovery stage) and the dimensional
    // breakdowns (country/referrer/social/os/browser) that the Social page
    // shows as a labelled "last 30 days" reference.
    const [links, stats] = await Promise.all([
      fetchShortIOLinks(),
      shortioFetch(
        `${STATS_BASE}/statistics/domain/${domainId}?` +
          new URLSearchParams({
            period: 'custom',
            startDate: breakdownStart,
            endDate: tomorrow,
            tz: 'UTC',
          }).toString(),
        apiKey
      ),
    ])

    const clickRows: Record<string, any>[] = []

    // Domain period total (last 30 days). human_clicks kept 0 here — per-day
    // human clicks live in the domain_daily rows below.
    clickRows.push({
      date: today,
      link_id: 'domain_total',
      total_clicks: Number(stats.clicks) || 0,
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

    // Authoritative per-day totals (domain_daily) over the last DAILY_DAYS.
    // Short.io's single daily-chart series is unreliable for per-day TOTAL
    // clicks — it approximates human/day, does not sum to the period total,
    // and its magnitude shifts with the query window. So instead we query each
    // day individually with a [day, day+1) window (endDate is exclusive) and
    // read that day's authoritative clicks / humanClicks. This makes every
    // dashboard range (today / yesterday / 7d / 30d / 90d) exact for both the
    // KPI cards and the trend. Requests are chunked to stay within the 120s
    // function budget; a failed day is skipped (not written as 0) so a
    // transient error never overwrites a previously-good row.
    const days: string[] = []
    for (let i = DAILY_DAYS - 1; i >= 0; i--) {
      days.push(iso(new Date(now.getTime() - i * DAY_MS)))
    }

    for (let i = 0; i < days.length; i += DAILY_CONCURRENCY) {
      const batch = days.slice(i, i + DAILY_CONCURRENCY)
      const settled = await Promise.all(
        batch.map(async (day) => {
          const nextStr = iso(new Date(new Date(`${day}T00:00:00.000Z`).getTime() + DAY_MS))
          const params = new URLSearchParams({
            period: 'custom',
            startDate: day,
            endDate: nextStr,
            tz: 'UTC',
          })
          try {
            const s = await shortioFetch(
              `${STATS_BASE}/statistics/domain/${domainId}?${params.toString()}`,
              apiKey
            )
            return { day, total: Number(s.clicks) || 0, human: Number(s.humanClicks) || 0, ok: true }
          } catch (err) {
            console.error(`[shortio] per-day fetch failed for ${day}:`, err)
            return { day, total: 0, human: 0, ok: false }
          }
        })
      )

      for (const r of settled) {
        if (!r.ok) continue
        clickRows.push({
          date: r.day,
          link_id: 'domain_daily',
          total_clicks: r.total,
          // Guard: human can never exceed total for a day.
          human_clicks: Math.min(Math.max(0, r.human), r.total),
          country: 'ALL',
          city: 'ALL',
          os: 'ALL',
          browser: 'ALL',
          referrer: 'ALL',
        })
      }
    }

    // Authoritative per-range period totals. Short.io's period "clicks" count
    // does NOT equal the sum of its per-day series for longer windows: older
    // per-day/granular data is decimated while the aggregate period counter is
    // retained (e.g. 30d period=1223 vs per-day sum=524). The period figure is
    // the number shown in Short.io's own dashboard, so we store one
    // authoritative total per standard dashboard range and let the Social page
    // read the matching one for its KPI cards. endDate is exclusive, so windows
    // that should include today end at `tomorrow`.
    const startOf = (daysAgo: number): string => iso(new Date(now.getTime() - daysAgo * DAY_MS))
    const rangeDefs: { key: string; startDate: string; endDate: string }[] = [
      { key: 'today', startDate: today, endDate: tomorrow },
      { key: 'yesterday', startDate: startOf(1), endDate: today },
      { key: '7d', startDate: startOf(7), endDate: tomorrow },
      { key: '30d', startDate: startOf(30), endDate: tomorrow },
      { key: '90d', startDate: startOf(90), endDate: tomorrow },
    ]
    const rangeResults = await Promise.all(
      rangeDefs.map(async (r) => {
        const params = new URLSearchParams({
          period: 'custom',
          startDate: r.startDate,
          endDate: r.endDate,
          tz: 'UTC',
        })
        try {
          const s = await shortioFetch(
            `${STATS_BASE}/statistics/domain/${domainId}?${params.toString()}`,
            apiKey
          )
          // The same period call also returns range-scoped dimensional
          // breakdowns (social / country / os), so we capture them here and
          // store per-range breakdown rows — no extra API calls needed.
          return {
            key: r.key,
            total: Number(s.clicks) || 0,
            human: Number(s.humanClicks) || 0,
            social: Array.isArray(s.social) ? s.social : [],
            country: Array.isArray(s.country) ? s.country : [],
            os: Array.isArray(s.os) ? s.os : [],
          }
        } catch (err) {
          console.error(`[shortio] range ${r.key} fetch failed:`, err)
          return null
        }
      })
    )
    for (const rr of rangeResults) {
      if (!rr) continue
      // Authoritative per-range total.
      clickRows.push({
        date: today,
        link_id: `range_${rr.key}`,
        total_clicks: rr.total,
        human_clicks: Math.min(Math.max(0, rr.human), rr.total),
        country: 'ALL',
        city: 'ALL',
        os: 'ALL',
        browser: 'ALL',
        referrer: 'ALL',
      })
      // Per-range social/platform breakdown (by_social_<key>).
      for (const s of rr.social) {
        clickRows.push({
          date: today,
          link_id: `by_social_${rr.key}`,
          total_clicks: s.score || 0,
          human_clicks: 0,
          country: 'ALL',
          city: 'ALL',
          os: 'ALL',
          browser: 'ALL',
          referrer: s.social || 'Unknown',
        })
      }
      // Per-range country breakdown (by_country_<key>).
      for (const c of rr.country) {
        const countryName = c.countryName || c.country || 'Unknown'
        clickRows.push({
          date: today,
          link_id: `by_country_${rr.key}`,
          total_clicks: c.score || 0,
          human_clicks: 0,
          country: countryName,
          city: countryName,
          os: 'ALL',
          browser: 'ALL',
          referrer: 'ALL',
        })
      }
      // Per-range OS/device breakdown (by_os_<key>).
      for (const o of rr.os) {
        clickRows.push({
          date: today,
          link_id: `by_os_${rr.key}`,
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

    console.log(`[shortio] Fetched ${links.length} links; 30d period total ${Number(stats.clicks) || 0} / human ${Number(stats.humanClicks) || 0}; ${days.length}-day per-day series; ${rangeResults.filter(Boolean).length} range totals; ${clickRows.length} click rows total`)

    return { links, clicks: clickRows }
  } catch (error) {
    console.error('[shortio] fetchAllShortIOData failed:', error)
    return { links: [], clicks: [] }
  }
}
