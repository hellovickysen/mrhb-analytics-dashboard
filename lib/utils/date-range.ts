/**
 * Shared date range utility for dashboard pages.
 *
 * Reads the `range` search param (7d | 30d | 90d) and returns
 * YYYY-MM-DD strings for Supabase queries.
 */

export type DateRangeKey = '7d' | '30d' | '90d'

const RANGE_DAYS: Record<DateRangeKey, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
}

export interface DateWindow {
  /** Start of the current period (YYYY-MM-DD) */
  startDate: string
  /** End date — today (YYYY-MM-DD) */
  endDate: string
  /** Start of the previous comparison period (YYYY-MM-DD) */
  prevStartDate: string
  /** End of the previous comparison period (= startDate) */
  prevEndDate: string
  /** Number of days in the window */
  days: number
  /** The range key (7d, 30d, 90d) */
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
 * The previous period is the same length, ending where the current period begins.
 * This enables period-over-period comparison for KPI change percentages.
 */
export function getDateWindow(
  searchParams?: { range?: string }
): DateWindow {
  const rangeKey = (searchParams?.range as DateRangeKey) || '30d'
  const days = RANGE_DAYS[rangeKey] || 30

  const now = new Date()
  const endDate = toDateString(now)
  const startDate = toDateString(new Date(now.getTime() - days * 24 * 60 * 60 * 1000))
  const prevStartDate = toDateString(new Date(now.getTime() - 2 * days * 24 * 60 * 60 * 1000))
  const prevEndDate = startDate

  return {
    startDate,
    endDate,
    prevStartDate,
    prevEndDate,
    days,
    range: rangeKey,
  }
}
