'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { RefreshCw } from 'lucide-react'

export type DateRange = 'today' | 'yesterday' | '7d' | '30d' | '90d'

interface HeaderProps {
  title: string
}

const RANGE_OPTIONS: { label: string; value: DateRange }[] = [
  { label: 'Today', value: 'today' },
  { label: 'Yesterday', value: 'yesterday' },
  { label: '7d', value: '7d' },
  { label: '30d', value: '30d' },
  { label: '90d', value: '90d' },
]

const RANGE_COOKIE = 'mrhb_range'
const VALID: DateRange[] = ['today', 'yesterday', '7d', '30d', '90d']

/** Read the persisted range cookie (client-only). */
function readRangeCookie(): DateRange | null {
  if (typeof document === 'undefined') return null
  const m = document.cookie.match(/(?:^|;\s*)mrhb_range=([^;]+)/)
  const v = m ? decodeURIComponent(m[1]) : ''
  return (VALID as string[]).includes(v) ? (v as DateRange) : null
}

/** Persist the selected range as a session cookie (cleared when the browser
 * closes) so it survives navigation between pages within the session. */
function writeRangeCookie(range: DateRange): void {
  if (typeof document === 'undefined') return
  document.cookie = `${RANGE_COOKIE}=${range}; path=/; SameSite=Lax`
}

export default function Header({ title }: HeaderProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const urlRange = (searchParams.get('range') as DateRange | null) ?? null
  const [activeRange, setActiveRange] = useState<DateRange>(urlRange ?? '30d')
  const [isRefreshing, setIsRefreshing] = useState(false)

  // Keep the URL, the cookie, and the highlighted button in sync.
  // - If the URL carries ?range=, that wins and we mirror it into the cookie.
  // - If the URL has no range but a range was chosen earlier this session
  //   (cookie), restore it by rewriting the URL so the server page renders
  //   the persisted range. Pages stay unchanged — the URL remains the source
  //   of truth; the cookie is only session memory.
  useEffect(() => {
    if (urlRange) {
      setActiveRange(urlRange)
      writeRangeCookie(urlRange)
      return
    }
    const saved = readRangeCookie()
    if (saved && saved !== '30d') {
      const params = new URLSearchParams(searchParams.toString())
      params.set('range', saved)
      router.replace(`${pathname}?${params.toString()}`)
      setActiveRange(saved)
    } else {
      setActiveRange('30d')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlRange, pathname])

  const handleRangeClick = (range: DateRange) => {
    writeRangeCookie(range)
    setActiveRange(range)
    const params = new URLSearchParams(searchParams.toString())
    params.set('range', range)
    router.push(`${pathname}?${params.toString()}`)
  }

  const handleRefresh = async () => {
    if (isRefreshing) return
    setIsRefreshing(true)
    try {
      router.refresh()
    } finally {
      setTimeout(() => setIsRefreshing(false), 1000)
    }
  }

  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <h1 className="text-2xl font-semibold text-mrhb-dark">{title}</h1>

      <div className="flex items-center gap-3">
        {/* Date range picker — updates URL search params + session cookie */}
        <div className="flex flex-wrap items-center rounded-lg border border-mrhb-warm-grey/30 bg-mrhb-white p-1">
          {RANGE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => handleRangeClick(option.value)}
              className={`rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${
                activeRange === option.value
                  ? 'bg-mrhb-blue text-mrhb-white'
                  : 'text-mrhb-dark/70 hover:bg-mrhb-blue-light'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {/* Refresh button */}
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="flex items-center gap-2 rounded-lg border border-mrhb-warm-grey/30 bg-mrhb-white px-3 py-2 text-sm font-medium text-mrhb-dark transition-colors hover:bg-mrhb-blue-light disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw
            size={16}
            className={isRefreshing ? 'animate-spin text-mrhb-blue' : ''}
          />
          {isRefreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>
    </div>
  )
}
