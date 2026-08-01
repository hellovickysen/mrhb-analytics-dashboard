'use client'

import { useEffect, useState } from 'react'
import {
  CheckCircle2,
  RefreshCw,
  Plus,
  Trash2,
  Save,
  BarChart3,
  Search,
  Smartphone,
  Link2,
  MousePointerClick,
  AlertTriangle,
  type LucideIcon,
} from 'lucide-react'
import { formatDate } from '@/lib/utils/format'

// ---------------------------------------------------------------------------
// Admin — Tracked Events is now REAL: it loads from and saves to the
// `tracked_events` table via /api/admin/tracked-events (service role). Each
// event can be assigned a Funnel Stage + order, which drives the User Journey
// funnel's app-event stages. Data Sources / Sync History below are still
// placeholder samples (labelled as such) pending a later wiring pass.
// ---------------------------------------------------------------------------

type EventCategory = 'transaction' | 'engagement' | 'conversion' | 'custom'

interface TrackedEventRow {
  id: string
  eventName: string
  displayName: string
  category: EventCategory
  funnelStage: string
  stageOrder: number
  trackAsRevenue: boolean
  active: boolean
}

const CATEGORY_OPTIONS: { value: EventCategory; label: string }[] = [
  { value: 'transaction', label: 'Transaction' },
  { value: 'engagement', label: 'Engagement' },
  { value: 'conversion', label: 'Conversion' },
  { value: 'custom', label: 'Custom' },
]

// Funnel stages an event can feed. '(none)' = tracked but not on the funnel.
// Order values align with the funnel: Installs=3, Dashboard=4, Transaction=5.
const FUNNEL_STAGE_OPTIONS: { value: string; order: number }[] = [
  { value: '', order: 0 },
  { value: 'App Installs', order: 3 },
  { value: '1st Transaction', order: 4 },
]

type SourceId = 'ga4' | 'gsc' | 'play' | 'shortio' | 'clarity'

interface DataSourceCard {
  id: SourceId
  name: string
  icon: LucideIcon
  lastSync: string
  records: number
  connected: boolean
  note?: string
}

const DATA_SOURCES: DataSourceCard[] = [
  { id: 'ga4', name: 'Google Analytics', icon: BarChart3, lastSync: 'Auto (daily)', records: 24312, connected: true, note: 'Website + Sahal Wallet Firebase' },
  { id: 'gsc', name: 'Google Search Console', icon: Search, lastSync: 'Auto (daily)', records: 4770, connected: true },
  { id: 'play', name: 'Play Store + App Store', icon: Smartphone, lastSync: 'Auto (daily)', records: 2, connected: true, note: 'Scraped from public pages' },
  { id: 'shortio', name: 'Short.io', icon: Link2, lastSync: 'Auto (daily)', records: 146, connected: true },
  { id: 'clarity', name: 'Microsoft Clarity', icon: MousePointerClick, lastSync: 'Never', records: 0, connected: false, note: 'API limited — 0 data returned' },
]

type SyncStatus = 'success' | 'error'

interface SyncHistoryRow {
  id: string
  source: string
  startedAt: string
  completedAt: string
  status: SyncStatus
  recordsSynced: number
}

const SYNC_HISTORY: SyncHistoryRow[] = [
  { id: 'sync-1', source: 'Google Analytics', startedAt: '2026-07-23T11:02:00Z', completedAt: '2026-07-23T11:04:12Z', status: 'success', recordsSynced: 1840 },
  { id: 'sync-2', source: 'Google Search Console', startedAt: '2026-07-23T10:05:00Z', completedAt: '2026-07-23T10:06:40Z', status: 'success', recordsSynced: 620 },
  { id: 'sync-3', source: 'Google Play Console', startedAt: '2026-07-23T12:00:00Z', completedAt: '2026-07-23T12:01:35Z', status: 'success', recordsSynced: 340 },
  { id: 'sync-4', source: 'Short.io', startedAt: '2026-07-23T12:30:00Z', completedAt: '2026-07-23T12:30:48Z', status: 'success', recordsSynced: 58 },
  { id: 'sync-5', source: 'Microsoft Clarity', startedAt: '2026-07-23T09:00:00Z', completedAt: '2026-07-23T09:00:52Z', status: 'success', recordsSynced: 4 },
]

function formatTime(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

let nextEventCounter = 1

// -----------------------------------------------------------------------------
// Toggle switch
// -----------------------------------------------------------------------------
function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 ${
        checked ? 'bg-mrhb-blue' : 'bg-mrhb-warm-grey/50'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-mrhb-white shadow transition-transform duration-200 ${
          checked ? 'translate-x-[18px]' : 'translate-x-[2px]'
        }`}
      />
    </button>
  )
}

// -----------------------------------------------------------------------------
// Data source card (sample — not yet wired to live sync)
// -----------------------------------------------------------------------------
function DataSourceStatusCard({ source }: { source: DataSourceCard }) {
  const [isSyncing, setIsSyncing] = useState(false)
  const [lastSync, setLastSync] = useState(source.lastSync)
  const Icon = source.icon

  const handleSync = () => {
    if (isSyncing) return
    setIsSyncing(true)
    setTimeout(() => {
      setIsSyncing(false)
      setLastSync('just now')
    }, 1600)
  }

  return (
    <div className="rounded-xl bg-mrhb-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div className={`flex h-10 w-10 items-center justify-center rounded-full ${source.connected ? 'bg-mrhb-blue-light' : 'bg-red-50'}`}>
          <Icon size={20} className={source.connected ? 'text-mrhb-blue' : 'text-red-400'} />
        </div>
        <div className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
          source.connected ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'
        }`}>
          <CheckCircle2 size={13} />
          {source.connected ? 'Connected' : 'Not Connected'}
        </div>
      </div>

      <p className="mt-4 text-sm font-semibold text-mrhb-dark">{source.name}</p>
      {source.note && <p className="mt-0.5 text-[11px] text-mrhb-dark/40">{source.note}</p>}

      <dl className="mt-3 space-y-1.5 text-xs text-mrhb-dark/60">
        <div className="flex items-center justify-between">
          <dt>Last sync</dt>
          <dd className="font-medium text-mrhb-dark/80">{lastSync}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt>Records</dt>
          <dd className="font-medium text-mrhb-dark/80">{source.records.toLocaleString()}</dd>
        </div>
      </dl>

      <button
        type="button"
        onClick={handleSync}
        disabled={isSyncing}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-mrhb-warm-grey/30 bg-mrhb-white px-3 py-2 text-sm font-medium text-mrhb-dark transition-colors hover:bg-mrhb-blue-light disabled:cursor-not-allowed disabled:opacity-60"
      >
        <RefreshCw size={14} className={isSyncing ? 'animate-spin text-mrhb-blue' : ''} />
        {isSyncing ? 'Syncing…' : 'Sync Now'}
      </button>
    </div>
  )
}

// -----------------------------------------------------------------------------
// Page
// -----------------------------------------------------------------------------
export default function AdminPage() {
  const [events, setEvents] = useState<TrackedEventRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [migrationNeeded, setMigrationNeeded] = useState(false)

  const load = () => {
    setLoading(true)
    fetch('/api/admin/tracked-events', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setErrorMessage(d.error)
        setMigrationNeeded(!!d.migrationNeeded)
        const rows: TrackedEventRow[] = (d.events ?? []).map((e: any, i: number) => ({
          id: e.id ?? `row-${i}`,
          eventName: e.event_name ?? '',
          displayName: e.display_name ?? '',
          category: (e.category ?? 'custom') as EventCategory,
          funnelStage: e.funnel_stage ?? '',
          stageOrder: Number(e.stage_order) || 0,
          trackAsRevenue: e.track_as_revenue === true,
          active: e.is_active !== false,
        }))
        setEvents(rows)
      })
      .catch((e) => setErrorMessage(String(e)))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [])

  const updateEvent = (id: string, patch: Partial<TrackedEventRow>) => {
    setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)))
  }

  const handleStageChange = (id: string, stage: string) => {
    const opt = FUNNEL_STAGE_OPTIONS.find((o) => o.value === stage)
    updateEvent(id, { funnelStage: stage, stageOrder: opt ? opt.order : 0 })
  }

  const handleAddEvent = () => {
    const id = `row-new-${nextEventCounter++}`
    setEvents((prev) => [
      ...prev,
      { id, eventName: '', displayName: '', category: 'custom', funnelStage: '', stageOrder: 0, trackAsRevenue: false, active: true },
    ])
  }

  const handleRemoveEvent = (id: string) => {
    setEvents((prev) => prev.filter((e) => e.id !== id))
  }

  const handleSave = () => {
    setSaving(true)
    setSaveMessage(null)
    setErrorMessage(null)
    const payload = {
      events: events
        .filter((e) => e.eventName.trim() !== '')
        .map((e) => ({
          event_name: e.eventName.trim(),
          display_name: e.displayName.trim() || e.eventName.trim(),
          category: e.category,
          is_active: e.active,
          track_as_revenue: e.trackAsRevenue,
          funnel_stage: e.funnelStage || null,
          stage_order: e.stageOrder,
        })),
    }
    fetch('/api/admin/tracked-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) {
          setErrorMessage(d.error ?? 'Save failed.')
          return
        }
        setMigrationNeeded(!!d.migrationNeeded)
        setSaveMessage(`Saved — ${d.count} events tracked${d.migrationNeeded ? ' (funnel-stage columns pending migration)' : ''}.`)
        setTimeout(() => setSaveMessage(null), 4000)
        load()
      })
      .catch((e) => setErrorMessage(String(e)))
      .finally(() => setSaving(false))
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-mrhb-dark">Admin Panel</h1>
        <p className="mt-1 text-sm text-mrhb-dark/60">Configure tracking events and manage data sources</p>
      </div>

      {/* Migration prompt */}
      {migrationNeeded && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <AlertTriangle size={16} className="mt-0.5 text-amber-600" />
          <div className="text-xs text-amber-800">
            <span className="font-semibold">Funnel-stage config pending.</span> Apply migration{' '}
            <code className="rounded bg-amber-100 px-1">002_tracked_events_funnel.sql</code> in the Supabase SQL
            editor to enable per-event funnel-stage assignment. Event names, labels, categories and toggles
            still save without it.
          </div>
        </div>
      )}

      {/* Section 1: Tracked Events Configuration */}
      <section className="mb-8 rounded-xl bg-mrhb-white p-5 shadow-sm">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-mrhb-dark">Tracked Events Configuration</h2>
            <p className="mt-0.5 text-sm text-mrhb-dark/50">
              GA4 events surfaced on the dashboard. Assign a Funnel Stage to feed the User Journey funnel.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleAddEvent}
              className="flex items-center gap-2 rounded-lg border border-mrhb-warm-grey/30 bg-mrhb-white px-3 py-2 text-sm font-medium text-mrhb-dark transition-colors hover:bg-mrhb-blue-light"
            >
              <Plus size={15} />
              Add Event
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || loading}
              className="flex items-center gap-2 rounded-lg bg-mrhb-blue px-3 py-2 text-sm font-medium text-mrhb-white transition-colors hover:bg-mrhb-blue/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Save size={15} />
              {saving ? 'Saving…' : 'Save Configuration'}
            </button>
          </div>
        </div>

        {saveMessage && (
          <div className="mb-4 flex items-center gap-2 rounded-lg bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700">
            <CheckCircle2 size={16} />
            {saveMessage}
          </div>
        )}
        {errorMessage && (
          <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 px-4 py-2.5 text-sm font-medium text-red-600">
            <AlertTriangle size={16} />
            {errorMessage}
          </div>
        )}

        {loading ? (
          <p className="py-8 text-center text-sm text-mrhb-dark/50">Loading tracked events…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-mrhb-warm-grey/20">
                  <th className="whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-mrhb-dark/50">Event Name</th>
                  <th className="whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-mrhb-dark/50">Display Name</th>
                  <th className="whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-mrhb-dark/50">Category</th>
                  <th className="whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-mrhb-dark/50">Funnel Stage</th>
                  <th className="whitespace-nowrap px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wide text-mrhb-dark/50">Revenue</th>
                  <th className="whitespace-nowrap px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wide text-mrhb-dark/50">Active</th>
                  <th className="whitespace-nowrap px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-mrhb-dark/50" />
                </tr>
              </thead>
              <tbody>
                {events.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-sm text-mrhb-dark/50">
                      No tracked events yet. The funnel uses built-in defaults until you add events here.
                    </td>
                  </tr>
                ) : (
                  events.map((event) => (
                    <tr key={event.id} className="border-b border-mrhb-warm-grey/10 last:border-0 hover:bg-mrhb-cream/60">
                      <td className="px-3 py-2.5">
                        <input
                          type="text"
                          value={event.eventName}
                          onChange={(e) => updateEvent(event.id, { eventName: e.target.value })}
                          placeholder="event_name"
                          className="w-full min-w-[160px] rounded-lg border border-mrhb-warm-grey/30 bg-mrhb-white px-2.5 py-1.5 font-mono text-xs text-mrhb-dark focus:border-mrhb-blue focus:outline-none focus:ring-1 focus:ring-mrhb-blue"
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <input
                          type="text"
                          value={event.displayName}
                          onChange={(e) => updateEvent(event.id, { displayName: e.target.value })}
                          placeholder="Display Name"
                          className="w-full min-w-[150px] rounded-lg border border-mrhb-warm-grey/30 bg-mrhb-white px-2.5 py-1.5 text-sm text-mrhb-dark focus:border-mrhb-blue focus:outline-none focus:ring-1 focus:ring-mrhb-blue"
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <select
                          value={event.category}
                          onChange={(e) => updateEvent(event.id, { category: e.target.value as EventCategory })}
                          className="rounded-lg border border-mrhb-warm-grey/30 bg-mrhb-white px-2.5 py-1.5 text-sm text-mrhb-dark focus:border-mrhb-blue focus:outline-none focus:ring-1 focus:ring-mrhb-blue"
                        >
                          {CATEGORY_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2.5">
                        <select
                          value={event.funnelStage}
                          onChange={(e) => handleStageChange(event.id, e.target.value)}
                          className="rounded-lg border border-mrhb-warm-grey/30 bg-mrhb-white px-2.5 py-1.5 text-sm text-mrhb-dark focus:border-mrhb-blue focus:outline-none focus:ring-1 focus:ring-mrhb-blue"
                        >
                          {FUNNEL_STAGE_OPTIONS.map((opt) => (
                            <option key={opt.value || 'none'} value={opt.value}>{opt.value || '(none)'}</option>
                          ))}
                          {event.funnelStage &&
                            !FUNNEL_STAGE_OPTIONS.some((o) => o.value === event.funnelStage) && (
                              <option value={event.funnelStage}>{event.funnelStage} (legacy)</option>
                            )}
                        </select>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <div className="flex justify-center">
                          <Toggle
                            checked={event.trackAsRevenue}
                            onChange={(next) => updateEvent(event.id, { trackAsRevenue: next })}
                            label={`Track ${event.displayName || event.eventName} as revenue`}
                          />
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <div className="flex justify-center">
                          <Toggle
                            checked={event.active}
                            onChange={(next) => updateEvent(event.id, { active: next })}
                            label={`${event.displayName || event.eventName} active`}
                          />
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => handleRemoveEvent(event.id)}
                          aria-label={`Remove ${event.displayName || event.eventName || 'event'}`}
                          className="rounded-lg p-1.5 text-mrhb-dark/40 transition-colors hover:bg-red-50 hover:text-red-500"
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Section 2: Data Sources Status (sample) */}
      <section className="mb-8">
        <h2 className="mb-4 text-base font-semibold text-mrhb-dark">
          Data Sources Status <span className="text-xs font-normal text-amber-600">· sample, not yet wired</span>
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {DATA_SOURCES.map((source) => (
            <DataSourceStatusCard key={source.id} source={source} />
          ))}
        </div>
      </section>

      {/* Section 3: Sync History (sample) */}
      <section>
        <div className="rounded-xl bg-mrhb-white p-5 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-mrhb-dark">
            Sync History <span className="text-xs font-normal text-amber-600">· sample, not yet wired</span>
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-mrhb-warm-grey/20">
                  <th className="whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-mrhb-dark/50">Source</th>
                  <th className="whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-mrhb-dark/50">Started</th>
                  <th className="whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-mrhb-dark/50">Completed</th>
                  <th className="whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-mrhb-dark/50">Status</th>
                  <th className="whitespace-nowrap px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-mrhb-dark/50">Records Synced</th>
                </tr>
              </thead>
              <tbody>
                {SYNC_HISTORY.map((row) => (
                  <tr key={row.id} className="border-b border-mrhb-warm-grey/10 last:border-0 hover:bg-mrhb-cream/60">
                    <td className="whitespace-nowrap px-3 py-2.5 font-medium text-mrhb-dark">{row.source}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-mrhb-dark/70">{formatDate(row.startedAt)} &middot; {formatTime(row.startedAt)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-mrhb-dark/70">
                      {row.completedAt ? `${formatDate(row.completedAt)} · ${formatTime(row.completedAt)}` : '—'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
                        row.status === 'success' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'
                      }`}>
                        {row.status === 'success' ? 'Success' : 'Error'}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right text-mrhb-dark">{row.recordsSynced.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  )
}
