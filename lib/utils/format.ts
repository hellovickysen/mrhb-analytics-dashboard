/**
 * Formatting utilities for the MRHB Analytics dashboard.
 */

/**
 * Compact number formatting.
 * Examples: 950 -> "950", 1200 -> "1.2K", 3400000 -> "3.4M", 2100000000 -> "2.1B"
 */
export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'

  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''

  if (abs < 1000) {
    return `${sign}${abs}`
  }

  const units = [
    { value: 1e12, suffix: 'T' },
    { value: 1e9, suffix: 'B' },
    { value: 1e6, suffix: 'M' },
    { value: 1e3, suffix: 'K' },
  ]

  for (const unit of units) {
    if (abs >= unit.value) {
      const formatted = (abs / unit.value).toFixed(1).replace(/\.0$/, '')
      return `${sign}${formatted}${unit.suffix}`
    }
  }

  return `${sign}${abs}`
}

/**
 * Percentage formatting with 1 decimal place.
 * Examples: 12.345 -> "12.3%", -4 -> "-4.0%"
 */
export function formatPercent(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return `${n.toFixed(1)}%`
}

/**
 * Human readable duration from seconds.
 * Examples: 83 -> "1m 23s", 45 -> "45s", 3725 -> "1h 2m 5s"
 */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) {
    return '—'
  }

  const totalSeconds = Math.max(0, Math.round(seconds))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const secs = totalSeconds % 60

  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`
  }

  if (minutes > 0) {
    return `${minutes}m ${secs}s`
  }

  return `${secs}s`
}

/**
 * Date formatting: MMM dd, yyyy (e.g. "Jul 23, 2026")
 */
export function formatDate(date: Date | string | number | null | undefined): string {
  if (date === null || date === undefined) return '—'

  const d = date instanceof Date ? date : new Date(date)

  if (Number.isNaN(d.getTime())) return '—'

  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  })
}
