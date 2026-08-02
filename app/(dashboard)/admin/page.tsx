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
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import { formatDate } from '@/lib/utils/format'

// ---------------------------------------------------------------------------
// Admin — all three sections are now REAL:
//  • Tracked Events  → /api/admin/tracked-events (drives the funnel's app stages)
//  • Data Sources    → /api/admin/sync-status (from data_sync_log); Sync Now
//                      triggers /api/refresh for that source
//  • Sync History    → /api/admin/sync-status (recent data_sync_log rows)
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

const FUNNEL_STAGE_OPTIONS: { value: string; order: number }[] = [
  { value: '', order: 0 },
  { value: 'App Installs', order: 3 },
  { value: 'Transaction', order: 4 },
]

type SourceId = 'ga4' | 'gsc' | 'shortio' | 'play' | 'clarity'

interface SourceMeta {
  key: SourceId
  name: string
  icon: LucideIcon
  note?: string
}

const SOURCE_META: SourceMeta[] = [
  { key: 'ga4', name: 'Google Analytics', icon: BarChart3, note: 'Website + Sahal Wallet Firebase' },
  { key: 'gsc', name: 'Google Search Console', icon: Search },
  { key: 'play', name: 'Play Store + App Store', icon: Smartphone, note: 'Scraped from public pages' },
  { key: 'shortio', name: 'Short.io', icon: Link2 },
  { key: 'clarity', name: 'Microsoft Clarity', icon: MousePointerClick, note: 'API often returns 0 rows' },
]

const SOURCE_NAME: Record<string, string> = {
  ga4: 'Google Analytics',
  gsc: 'Google Search Console',
  shortio: 'Short.io',
  play: 'Play Store + App Store',
  clarity: 'Microsoft Clarity',
}

interface SourceStatus {
  key: string
  lastSyncAt: string | null
  lastStatus: string | null
  records: number
}

interface HistoryRow {
  source: string
  status: string
  started_at: string
  completed_at: string | null
  records_synced: number
  error_message: string | null
}

function formatTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

function relTime(iso: string | null): string {
  if (!iso) return 'Never'
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return '—'
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

function statusPill(status: string | null): { label: string; cls: string } {
  if (status === 'success') return { label: 'Active', cls: 'bg-emerald-50 text-emerald-600' }
  if (status === 'error') return { label: 'Error', cls: 'bg-red-50 text-red-500' }
  if (status === 'running') return { label: 'Running', cls: 'bg-mrhb-blue-light text-mrhb-blue' }
  return { label: 'No data', cls: 'bg-mrhb-warm-grey/20 text-mrhb-dark/50' }
}

interface ToolRow {
  id: string
  tool: string
  patterns: string
  sortOrder: number
  active: boolean
}

let nextEventCounter = 1
let nextToolCounter = 1

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

function DataSourceStatusCard({
  meta,
  status,
  onSynced,
}: {
  meta: SourceMeta
  status: SourceStatus | undefined
  onSynced: () => void
}) {
  const [isSyncing, setIsSyncing] = useState(false)
  const Icon = meta.icon
  const st = status?.lastStatus ?? null
  const pill = statusPill(st)
  const ok = st === 'success'

  const handleSync = () => {
    if (isSyncing) return
    setIsSyncing(true)
    fetch('/api/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: meta.key, daysBack: 7 }),
    })
      .then((r) => r.json())
      .catch(() => {})
      .finally(() => {
        setIsSyncing(false)
        onSynced()
      })
  }

  return (
    <div className="rounded-xl bg-mrhb-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div className={`flex h-10 w-10 items-center justify-center rounded-full ${ok ? 'bg-mrhb-blue-light' : 'bg-mrhb-warm-grey/20'}`}>
          <Icon size={20} className={ok ? 'text-mrhb-blue' : 'text-mrhb-dark/40'} />
        </div>
        <div className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${pill.cls}`}>
          {st === 'error' ? <XCircle size={13} /> : <CheckCircle2 size={13} />}
          {pill.label}
        </div>
      </div>

      <p className="mt-4 text-sm font-semibold text-mrhb-dark">{meta.name}</p>
      {meta.note && <p className="mt-0.5 text-[11px] text-mrhb-dark/40">{meta.note}</p>}

      <dl className="mt-3 space-y-1.5 text-xs text-mrhb-dark/60">
        <div className="flex items-center justify-between">
          <dt>Last sync</dt>
          <dd className="font-medium text-mrhb-dark/80">{relTime(status?.lastSyncAt ?? null)}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt>Records (last run)</dt>
          <dd className="font-medium text-mrhb-dark/80">{(status?.records ?? 0).toLocaleString()}</dd>
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

export default function AdminPage() {
  const [events, setEvents] = useState<TrackedEventRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [migrationNeeded, setMigrationNeeded] = useState(false)

  const [sources, setSources] = useState<SourceStatus[]>([])
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [syncLoading, setSyncLoading] = useState(true)

  const [tools, setTools] = useState<ToolRow[]>([])
  const [toolsLoading, setToolsLoading] = useState(true)
  const [toolsMigration, setToolsMigration] = useState(false)
  const [toolsSaving, setToolsSaving] = useState(false)
  const [toolsMsg, setToolsMsg] = useState<string | null>(null)

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

  const loadSyncStatus = () => {
    setSyncLoading(true)
    fetch('/api/admin/sync-status', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        setSources(d.sources ?? [])
        setHistory(d.history ?? [])
      })
      .catch(() => {})
      .finally(() => setSyncLoading(false))
  }

  const loadTools = () => {
    setToolsLoading(true)
    fetch('/api/admin/tool-config', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        setToolsMigration(!!d.tableMissing)
        const rows: ToolRow[] = (d.tools ?? []).map((t: any, i: number) => ({
          id: t.id ?? `tool-${i}`,
          tool: t.tool ?? '',
          patterns: t.patterns ?? '',
          sortOrder: Number(t.sort_order) || 0,
          active: t.is_active !== false,
        }))
        setTools(rows)
      })
      .catch(() => {})
      .finally(() => setToolsLoading(false))
  }

  const updateTool = (id: string, patch: Partial<ToolRow>) => {
    setTools((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  }
  const addTool = () => {
    const id = `tool-new-${nextToolCounter++}`
    setTools((prev) => [...prev, { id, tool: '', patterns: '', sortOrder: (prev.length + 1) * 10, active: true }])
  }
  const removeTool = (id: string) => setTools((prev) => prev.filter((t) => t.id !== id))
  const saveTools = () => {
    setToolsSaving(true)
    setToolsMsg(null)
    fetch('/api/admin/tool-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tools: tools
          .filter((t) => t.tool.trim() !== '')
          .map((t) => ({ tool: t.tool.trim(), patterns: t.patterns, sort_order: t.sortOrder, is_active: t.active })),
      }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.tableMissing) {
          setToolsMigration(true)
          setToolsMsg('Run migration 003_tool_usage_config.sql in Supabase to save tool mappings.')
          return
        }
        if (!d.ok) {
          setToolsMsg(d.error ?? 'Save failed.')
          return
        }
        setToolsMsg(`Saved — ${d.count} tools mapped.`)
        setTimeout(() => setToolsMsg(null), 4000)
        loadTools()
      })
      .catch((e) => setToolsMsg(String(e)))
      .finally(() => setToolsSaving(false))
  }

  useEffect(() => {
    load()
    loadSyncStatus()
    loadTools()
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

  const sourceByKey = (key: string): SourceStatus | undefined => sources.find((s) => s.key === key)

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-mrhb-dark">Admin Panel</h1>
        <p className="mt-1 text-sm text-mrhb-dark/60">Configure tracking events and manage data sources</p>
      </div>

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

      {/* Section 1b: Tool Usage Mapping */}
      <section className="mb-8 rounded-xl bg-mrhb-white p-5 shadow-sm">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-mrhb-dark">Tool Usage Mapping</h2>
            <p className="mt-0.5 text-sm text-mrhb-dark/50">
              Maps each in-app tool to UPPERCASE event-name substrings (comma-separated). Drives the App Performance
              &ldquo;Tool Usage&rdquo; section. First-match-wins by order.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={addTool}
              className="flex items-center gap-2 rounded-lg border border-mrhb-warm-grey/30 bg-mrhb-white px-3 py-2 text-sm font-medium text-mrhb-dark transition-colors hover:bg-mrhb-blue-light"
            >
              <Plus size={15} />
              Add Tool
            </button>
            <button
              type="button"
              onClick={saveTools}
              disabled={toolsSaving || toolsLoading}
              className="flex items-center gap-2 rounded-lg bg-mrhb-blue px-3 py-2 text-sm font-medium text-mrhb-white transition-colors hover:bg-mrhb-blue/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Save size={15} />
              {toolsSaving ? 'Saving…' : 'Save Mapping'}
            </button>
          </div>
        </div>

        {toolsMigration && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
            <AlertTriangle size={15} className="mt-0.5" />
            <span>
              Showing built-in defaults. Apply <code className="rounded bg-amber-100 px-1">003_tool_usage_config.sql</code> in
              Supabase to persist edits (the Tool Usage section already works on these defaults meanwhile).
            </span>
          </div>
        )}
        {toolsMsg && (
          <div className="mb-4 rounded-lg bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700">{toolsMsg}</div>
        )}

        {toolsLoading ? (
          <p className="py-6 text-center text-sm text-mrhb-dark/50">Loading tool mapping…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-mrhb-warm-grey/20">
                  <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-mrhb-dark/50">Tool</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-mrhb-dark/50">Event patterns (comma-separated)</th>
                  <th className="px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wide text-mrhb-dark/50">Order</th>
                  <th className="px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wide text-mrhb-dark/50">Active</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-mrhb-dark/50" />
                </tr>
              </thead>
              <tbody>
                {tools.map((t) => (
                  <tr key={t.id} className="border-b border-mrhb-warm-grey/10 last:border-0 hover:bg-mrhb-cream/60">
                    <td className="px-3 py-2.5">
                      <input
                        type="text"
                        value={t.tool}
                        onChange={(e) => updateTool(t.id, { tool: e.target.value })}
                        placeholder="Tool name"
                        className="w-full min-w-[130px] rounded-lg border border-mrhb-warm-grey/30 bg-mrhb-white px-2.5 py-1.5 text-sm text-mrhb-dark focus:border-mrhb-blue focus:outline-none focus:ring-1 focus:ring-mrhb-blue"
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <input
                        type="text"
                        value={t.patterns}
                        onChange={(e) => updateTool(t.id, { patterns: e.target.value })}
                        placeholder="MIRO, MIRO_STAKE"
                        className="w-full min-w-[220px] rounded-lg border border-mrhb-warm-grey/30 bg-mrhb-white px-2.5 py-1.5 font-mono text-xs text-mrhb-dark focus:border-mrhb-blue focus:outline-none focus:ring-1 focus:ring-mrhb-blue"
                      />
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <input
                        type="number"
                        value={t.sortOrder}
                        onChange={(e) => updateTool(t.id, { sortOrder: Number(e.target.value) || 0 })}
                        className="w-16 rounded-lg border border-mrhb-warm-grey/30 bg-mrhb-white px-2 py-1.5 text-center text-sm text-mrhb-dark focus:border-mrhb-blue focus:outline-none focus:ring-1 focus:ring-mrhb-blue"
                      />
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <div className="flex justify-center">
                        <Toggle checked={t.active} onChange={(next) => updateTool(t.id, { active: next })} label={`${t.tool} active`} />
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => removeTool(t.id)}
                        aria-label={`Remove ${t.tool || 'tool'}`}
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
        )}
      </section>

      {/* Section 2: Data Sources Status (live) */}
      <section className="mb-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-mrhb-dark">Data Sources Status</h2>
          <button
            type="button"
            onClick={loadSyncStatus}
            className="flex items-center gap-1.5 text-xs font-medium text-mrhb-blue hover:underline"
          >
            <RefreshCw size={13} className={syncLoading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {SOURCE_META.map((meta) => (
            <DataSourceStatusCard key={meta.key} meta={meta} status={sourceByKey(meta.key)} onSynced={loadSyncStatus} />
          ))}
        </div>
      </section>

      {/* Section 3: Sync History (live) */}
      <section>
        <div className="rounded-xl bg-mrhb-white p-5 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-mrhb-dark">Sync History</h2>
          {syncLoading ? (
            <p className="py-6 text-center text-sm text-mrhb-dark/50">Loading sync history…</p>
          ) : history.length === 0 ? (
            <p className="py-6 text-center text-sm text-mrhb-dark/50">No sync runs recorded yet.</p>
          ) : (
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
                  {history.map((row, i) => {
                    const pill = statusPill(row.status)
                    return (
                      <tr key={`${row.source}-${row.started_at}-${i}`} className="border-b border-mrhb-warm-grey/10 last:border-0 hover:bg-mrhb-cream/60">
                        <td className="whitespace-nowrap px-3 py-2.5 font-medium text-mrhb-dark">{SOURCE_NAME[row.source] ?? row.source}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-mrhb-dark/70">
                          {formatDate(row.started_at)} &middot; {formatTime(row.started_at)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-mrhb-dark/70">
                          {row.completed_at ? `${formatDate(row.completed_at)} · ${formatTime(row.completed_at)}` : '—'}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5">
                          <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${pill.cls}`}>
                            {pill.label}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right text-mrhb-dark">{(row.records_synced ?? 0).toLocaleString()}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
