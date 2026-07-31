'use client'

/**
 * DataFreshnessBar — a slim, dashboard-wide indicator of when each data source
 * last synced successfully. Fetches /api/freshness (which reads data_sync_log)
 * on mount and renders one chip per source with a colored dot + relative age.
 *
 * Thresholds for LIVE sources:
 *   - <= 24h  → fresh  (green)
 *   - 24-48h  → warn   (amber)
 *   - > 48h / never → stale (red)
 * Clarity is intentionally mock, so it renders neutral and never triggers a
 * warning. A warning line appears only when a live source is warn/stale, so a
 * stalled pipeline (e.g. a paused DB) is visible instead of silently serving
 * stale numbers.
 *
 * Client component (lives under components/, per the repo's server/client
 * split). The actual DB read happens server-side in the API route.
 */

import { useEffect, useState } from 'react'
import { Clock, AlertTriangle } from 'lucide-react'

interface FreshnessSource {
  key: string
  label: string
  mock: boolean
  lastSuccessAt: string | null
  ageHours: number | null
}

interface FreshnessPayload {
  generatedAt: string
  error?: string
  sources: FreshnessSource[]
}

type Status = 'fresh' | 'warn' | 'stale'

function liveStatus(ageHours: number | null): Status {
  if (ageHours === null) return 'stale'
  if (ageHours <= 24) return 'fresh'
  if (ageHours <= 48) return 'warn'
  return 'stale'
}

function relAge(ageHours: number | null): string {
  if (ageHours === null) return 'never synced'
  if (ageHours < 1) return 'just now'
  if (ageHours < 24) return `${Math.round(ageHours)}h ago`
  const days = ageHours / 24
  return `${Math.round(days)}d ago`
}

const DOT: Record<Status, string> = {
  fresh: 'bg-emerald-500',
  warn: 'bg-amber-500',
  stale: 'bg-red-500',
}

export default function DataFreshnessBar() {
  const [payload, setPayload] = useState<FreshnessPayload | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const res = await fetch('/api/freshness', { cache: 'no-store' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as FreshnessPayload
        if (active) setPayload(json)
      } catch {
        if (active) setFailed(true)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  // Nothing to show yet (initial load) — stay invisible to avoid layout jitter.
  if (!payload && !failed) return null

  // Indicator itself couldn't load, or the API reported a DB error / no rows.
  if (failed || !payload || payload.error || payload.sources.length === 0) {
    return (
      <div className="mb-4 flex items-center gap-1.5 rounded-xl border border-mrhb-warm-grey/20 bg-mrhb-white px-4 py-2 text-xs text-mrhb-dark/50 shadow-sm">
        <Clock size={13} />
        <span>Data freshness unavailable{payload?.error ? ' — source database not reachable' : ''}</span>
      </div>
    )
  }

  const liveSources = payload.sources.filter((s) => !s.mock)
  const anyStale = liveSources.some((s) => liveStatus(s.ageHours) === 'stale')
  const anyWarn = liveSources.some((s) => liveStatus(s.ageHours) === 'warn')
  const worst: Status = anyStale ? 'stale' : anyWarn ? 'warn' : 'fresh'

  const borderClass =
    worst === 'stale'
      ? 'border-l-4 border-l-red-500'
      : worst === 'warn'
        ? 'border-l-4 border-l-amber-500'
        : 'border-l-4 border-l-emerald-500'

  return (
    <div
      className={`mb-4 rounded-xl border border-mrhb-warm-grey/20 bg-mrhb-white px-4 py-2.5 shadow-sm ${borderClass}`}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <span className="flex items-center gap-1.5 font-semibold text-mrhb-dark/70">
          <Clock size={13} />
          Data freshness
        </span>

        {payload.sources.map((s) => {
          const status: Status = s.mock ? 'fresh' : liveStatus(s.ageHours)
          const dot = s.mock ? 'bg-mrhb-warm-grey/50' : DOT[status]
          return (
            <span key={s.key} className="flex items-center gap-1.5">
              <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
              <span className="font-medium text-mrhb-dark/80">{s.label}</span>
              <span className="text-mrhb-dark/45">{s.mock ? 'mock' : relAge(s.ageHours)}</span>
            </span>
          )
        })}
      </div>

      {worst !== 'fresh' && (
        <div
          className={`mt-2 flex items-center gap-1.5 text-xs font-medium ${
            worst === 'stale' ? 'text-red-600' : 'text-amber-600'
          }`}
        >
          <AlertTriangle size={13} />
          <span>
            {worst === 'stale'
              ? "Some sources haven't synced in over 48h — figures may be outdated. If the database was paused, it re-syncs automatically once it's back online."
              : 'Some sources are 24-48h old — a fresh sync is due shortly.'}
          </span>
        </div>
      )}
    </div>
  )
}
