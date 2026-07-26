/**
 * Shared date range utility for dashboard pages.
 *
 * Reads the `range` search param (today | yesterday | 7d | 30d | 90d)
 * and returns YYYY-MM-DD strings for Supabase queries.
 */

export type DateRangeKey = 'today' | 'yesterday' | '7d' | '30d' | '90d'

export interface DateWindow {
  /** Start of the current period (YYYY-MM-DD) */
  startDate: string
  /** End date (YYYY-MM-DD) */
  endDate: string
  /** Start of the previous comparison period (YYYY-MM-DD) */
  prevStartDate: string
  /** End of the previous comparison period (= startDate) */
  prevEndDate: string
  /** Number of days in the window */
  days: number
  /** The range key */
  range: DateRangeKey
}

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * Parse the `range` search param into a DateWindow with current and previous
 * period boundaries. Pages pass `searchParams.range` and get back dates
 * ready for Supabase `.gte('date', startDate)` queries.
 *
 * - today: current day, compared to yesterday
 * - yesterday: previous day, compared to the day before
 * - 7d/30d/90d: last N days, compared to the N days before that
 */
export function getDateWindow(
  searchParams?: { range?: string }
): DateWindow {
  const rangeKey = (searchParams?.range as DateRangeKey) || '30d'
  const now = new Date()
  const DAY = 24 * 60 * 60 * 1000

  let startDate: string
  let endDate: string
  let prevStartDate: string
  let prevEndDate: string
  let days: number

  switch (rangeKey) {
    case 'today':
      days = 1
      endDate = toDateString(now)
      startDate = endDate // same day
      prevEndDate = startDate
      prevStartDate = toDateString(new Date(now.getTime() - DAY)) // yesterday
      break

    case 'yesterday':
      days = 1
      endDate = toDateString(new Date(now.getTime() - DAY))
      startDate = endDate // same day
      prevEndDate = startDate
      prevStartDate = toDateString(new Date(now.getTime() - 2 * DAY)) // day before yesterday
      break

    default: {
      const daysMap: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 }
      days = daysMap[rangeKey] || 30
      endDate = toDateString(now)
      startDate = toDateString(new Date(now.getTime() - days * DAY))
      prevStartDate = toDateString(new Date(now.getTime() - 2 * days * DAY))
      prevEndDate = startDate
      break
    }
  }

  return {
    startDate,
    endDate,
    prevStartDate,
    prevEndDate,
    days,
    range: rangeKey,
  }
}
