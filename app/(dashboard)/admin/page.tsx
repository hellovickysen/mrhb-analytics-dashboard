'use client'

import { useState } from 'react'
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
  type LucideIcon,
} from 'lucide-react'
import { formatDate } from '@/lib/utils/format'

// ---------------------------------------------------------------------------
// This is a Client Component ('use client') — it owns all of its state
// locally via useState. In production, the initial values below would be
// hydrated from Supabase (`tracked_event`, `data_sync_log` tables) via a
// server action or an API route, then mutated here through local state plus
// optimistic writes back to Supabase. For now everything lives in memory so
// the interactive behavior (add/edit/toggle/save/sync) can be reviewed before
// the persistence layer is wired up.
// ---------------------------------------------------------------------------

type EventCategory = 'transaction' | 'engagement' | 'conversion' | 'custom'

interface TrackedEventRow {
  id: string
  eventName: string
  displayName: string
  category: EventCategory
  trackAsRevenue: boolean
  active: boolean
}

const CATEGORY_OPTIONS: { value: EventCategory; label: string }[] = [
  { value: 'transaction', label: 'Transaction' },
  { value: 'engagement', label: 'Engagement' },
  { value: 'conversion', label: 'Conversion' },
  { value: 'custom', label: 'Custom' },
]

const INITIAL_EVENTS: TrackedEventRow[] = [
  { id: 'evt-1', eventName: 'wallet_created', displayName: 'Wallet Created', category: 'conversion', trackAsRevenue: false, active: true },
  { id: 'evt-2', eventName: 'wallet_funded', displayName: 'Wallet Funded', category: 'transaction', trackAsRevenue: false, active: true },
  { id: 'evt-3', eventName: 'token_swap', displayName: 'Token Swap', category: 'transaction', trackAsRevenue: true, active: true },
  { id: 'evt-4', eventName: 'gift_card_purchased', displayName: 'Gift Card Purchase', category: 'transaction', trackAsRevenue: true, active: true },
  { id: 'evt-5', eventName: 'donation_made', displayName: 'Donation Made', category: 'transaction', trackAsRevenue: false, active: true },
  { id: 'evt-6', eventName: 'commodity_purchased', displayName: 'Commodity Purchase', category: 'transaction', trackAsRevenue: true, active: true },
  { id: 'evt-7', eventName: 'staking_initiated', displayName: 'Staking Initiated', category: 'transaction', trackAsRevenue: true, active: true },
  { id: 'evt-8', eventName: 'app_opened', displayName: 'App Opened', category: 'engagement', trackAsRevenue: false, active: true },
  { id: 'evt-9', eventName: 'onboarding_completed', displayName: 'Onboarding Complete', category: 'conversion', trackAsRevenue: false, active: true },
  { id: 'evt-10', eventName: 'kyc_completed', displayName: 'KYC Completed', category: 'conversion', trackAsRevenue: false, active: true },
  { id: 'evt-11', eventName: 'token_screened', displayName: 'Token Screened', category: 'engagement', trackAsRevenue: false, active: true },
  { id: 'evt-12', eventName: 'referral_shared', displayName: 'Referral Shared', category: 'engagement', trackAsRevenue: false, active: true },
  { id: 'evt-13', eventName: 'purchase', displayName: 'Purchase', category: 'transaction', trackAsRevenue: true, active: true },
  { id: 'evt-14', eventName: 'in_app_purchase', displayName: 'In-App Purchase', category: 'transaction', trackAsRevenue: true, active: true },
  { id: 'evt-15', eventName: 'first_transaction', displayName: 'First Transaction', category: 'conversion', trackAsRevenue: true, active: true },
]

type SourceId = 'ga4' | 'gsc' | 'play' | 'shortio' | 'clarity'

interface DataSourceCard {
  id: SourceId
  name: string
  icon: LucideIcon
  lastSync: string
  records: number
}

const DATA_SOURCES: DataSourceCard[] = [
  { id: 'ga4', name: 'Google Analytics', icon: BarChart3, lastSync: '2 hours ago', records: 48210 },
  { id: 'gsc', name: 'Google Search Console', icon: Search, lastSync: '3 hours ago', records: 12340 },
  { id: 'play', name: 'Google Play Console', icon: Smartphone, lastSync: '1 hour ago', records: 6320 },
  { id: 'shortio', name: 'Short.io', icon: Link2, lastSync: '30 min ago', records: 1166 },
  { id: 'clarity', name: 'Microsoft Clarity', icon: MousePointerClick, lastSync: '4 hours ago', records: 20 },
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
  { id: 'sync-6', source: 'Google Analytics', startedAt: '2026-07-22T23:02:00Z', completedAt: '2026-07-22T23:04:05Z', status: 'success', recordsSynced: 1795 },
  { id: 'sync-7', source: 'Google Play Console', startedAt: '2026-07-22T18:00:00Z', completedAt: '', status: 'error', recordsSynced: 0 },
  { id: 'sync-8', source: 'Google Search Console', startedAt: '2026-07-22T10:05:00Z', completedAt: '2026-07-22T10:07:02Z', status: 'success', recordsSynced: 598 },
  { id: 'sync-9', source: 'Short.io', startedAt: '2026-07-22T06:30:00Z', completedAt: '2026-07-22T06:31:10Z', status: 'success', recordsSynced: 61 },
  { id: 'sync-10', source: 'Google Analytics', startedAt: '2026-07-21T23:02:00Z', completedAt: '2026-07-21T23:04:22Z', status: 'success', recordsSynced: 1712 },
]

function formatTime(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

let nextEventCounter = INITIAL_EVENTS.length + 1

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
// Data source card
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
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-mrhb-blue-light">
          <Icon size={20} className="text-mrhb-blue" />
        </div>
        <div className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-600">
          <CheckCircle2 size={13} />
          Connected
        </div>
      </div>

      <p className="mt-4 text-sm font-semibold text-mrhb-dark">{source.name}</p>

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
  const [events, setEvents] = useState<TrackedEventRow[]>(INITIAL_EVENTS)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)

  const updateEvent = (id: string, patch: Partial<TrackedEventRow>) => {
    setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)))
  }

  const handleAddEvent = () => {
    const id = `evt-new-${nextEventCounter++}`
    setEvents((prev) => [
      ...prev,
      {
        id,
        eventName: '',
        displayName: '',
        category: 'custom',
        trackAsRevenue: false,
        active: true,
      },
    ])
  }

  const handleRemoveEvent = (id: string) => {
    setEvents((prev) => prev.filter((e) => e.id !== id))
  }

  const handleSave = () => {
    setSaveMessage(`Configuration saved — ${events.length} events tracked.`)
    setTimeout(() => setSaveMessage(null), 3500)
  }

  return (
    <div>
      {/* Inline header — this page is a client component, so it builds its
          own header block rather than importing the shared Header (which
          owns date-range state meant for the analytics pages, not admin). */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-mrhb-dark">Admin Panel</h1>
        <p className="mt-1 text-sm text-mrhb-dark/60">
          Configure tracking events and manage data sources
        </p>
      </div>

      {/* -------------------------------------------------------------- */}
      {/* Section 1: Tracked Events Configuration                        */}
      {/* -------------------------------------------------------------- */}
      <section className="mb-8 rounded-xl bg-mrhb-white p-5 shadow-sm">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-mrhb-dark">
              Tracked Events Configuration
            </h2>
            <p className="mt-0.5 text-sm text-mrhb-dark/50">
              GA4 events synced into the dashboard&apos;s event pipeline
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
              className="flex items-center gap-2 rounded-lg bg-mrhb-blue px-3 py-2 text-sm font-medium text-mrhb-white transition-colors hover:bg-mrhb-blue/90"
            >
              <Save size={15} />
              Save Configuration
            </button>
          </div>
        </div>

        {saveMessage && (
          <div className="mb-4 flex items-center gap-2 rounded-lg bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700">
            <CheckCircle2 size={16} />
            {saveMessage}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-mrhb-warm-grey/20">
                <th className="whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-mrhb-dark/50">
                  Event Name
                </th>
                <th className="whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-mrhb-dark/50">
                  Display Name
                </th>
                <th className="whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-mrhb-dark/50">
                  Category
                </th>
                <th className="whitespace-nowrap px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wide text-mrhb-dark/50">
                  Track as Revenue
                </th>
                <th className="whitespace-nowrap px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wide text-mrhb-dark/50">
                  Active
                </th>
                <th className="whitespace-nowrap px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-mrhb-dark/50">
                  {/* remove column */}
                </th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr
                  key={event.id}
                  className="border-b border-mrhb-warm-grey/10 last:border-0 hover:bg-mrhb-cream/60"
                >
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
                      className="w-full min-w-[160px] rounded-lg border border-mrhb-warm-grey/30 bg-mrhb-white px-2.5 py-1.5 text-sm text-mrhb-dark focus:border-mrhb-blue focus:outline-none focus:ring-1 focus:ring-mrhb-blue"
                    />
                  </td>
                  <td className="px-3 py-2.5">
                    <select
                      value={event.category}
                      onChange={(e) =>
                        updateEvent(event.id, { category: e.target.value as EventCategory })
                      }
                      className="rounded-lg border border-mrhb-warm-grey/30 bg-mrhb-white px-2.5 py-1.5 text-sm text-mrhb-dark focus:border-mrhb-blue focus:outline-none focus:ring-1 focus:ring-mrhb-blue"
                    >
                      {CATEGORY_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
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
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* -------------------------------------------------------------- */}
      {/* Section 2: Data Sources Status                                  */}
      {/* -------------------------------------------------------------- */}
      <section className="mb-8">
        <h2 className="mb-4 text-base font-semibold text-mrhb-dark">Data Sources Status</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {DATA_SOURCES.map((source) => (
            <DataSourceStatusCard key={source.id} source={source} />
          ))}
        </div>
      </section>

      {/* -------------------------------------------------------------- */}
      {/* Section 3: Sync History                                        */}
      {/* -------------------------------------------------------------- */}
      <section>
        <div className="rounded-xl bg-mrhb-white p-5 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-mrhb-dark">Sync History</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-mrhb-warm-grey/20">
                  <th className="whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-mrhb-dark/50">
                    Source
                  </th>
                  <th className="whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-mrhb-dark/50">
                    Started
                  </th>
                  <th className="whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-mrhb-dark/50">
                    Completed
                  </th>
                  <th className="whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-mrhb-dark/50">
                    Status
                  </th>
                  <th className="whitespace-nowrap px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-mrhb-dark/50">
                    Records Synced
                  </th>
                </tr>
              </thead>
              <tbody>
                {SYNC_HISTORY.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-mrhb-warm-grey/10 last:border-0 hover:bg-mrhb-cream/60"
                  >
                    <td className="whitespace-nowrap px-3 py-2.5 font-medium text-mrhb-dark">
                      {row.source}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-mrhb-dark/70">
                      {formatDate(row.startedAt)} &middot; {formatTime(row.startedAt)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-mrhb-dark/70">
                      {row.completedAt
                        ? `${formatDate(row.completedAt)} · ${formatTime(row.completedAt)}`
                        : '—'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
                          row.status === 'success'
                            ? 'bg-emerald-50 text-emerald-600'
                            : 'bg-red-50 text-red-500'
                        }`}
                      >
                        {row.status === 'success' ? 'Success' : 'Error'}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right text-mrhb-dark">
                      {row.recordsSynced.toLocaleString()}
                    </td>
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
