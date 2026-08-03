'use client'

import { useState } from 'react'
import KPICard from '@/components/cards/KPICard'
import AreaChart, { type AreaChartDataPoint } from '@/components/charts/AreaChart'
import BarChart, { type BarChartDataPoint } from '@/components/charts/BarChart'
import DataTable, { type DataTableColumn } from '@/components/tables/DataTable'
import { formatNumber, formatPercent } from '@/lib/utils/format'

export interface ToolTabData {
  tool: string
  users: number
  events: number
  android: number
  ios: number
  web: number
  trend: Array<{ date: string; users: number; events: number }>
}

function shortDate(d: string): string {
  const dt = new Date(`${d}T00:00:00Z`)
  if (Number.isNaN(dt.getTime())) return d
  return dt.toLocaleDateString('en-US', { month: 'short', day: '2-digit', timeZone: 'UTC' })
}

/** Average daily users = total (summed-daily) users ÷ days in the range. */
function avgDaily(users: number, rangeDays: number): number {
  return rangeDays > 0 ? users / rangeDays : users
}
function fmtAvg(v: number): string {
  return v >= 10 ? formatNumber(Math.round(v)) : v.toFixed(1)
}

const OVERVIEW_COLUMNS: DataTableColumn[] = [
  { key: 'tool', label: 'Tool', align: 'left', sortable: true },
  { key: 'users', label: 'Active Users', align: 'right', sortable: true },
  { key: 'avgDaily', label: 'Avg/day', align: 'right', sortable: true },
  { key: 'events', label: 'Events', align: 'right', sortable: true },
  { key: 'platform', label: 'Android / iOS / Web', align: 'right' },
  { key: 'share', label: 'Share', align: 'right', sortable: true },
]

export default function ToolUsageTabs({ tools, rangeLabel, rangeDays }: { tools: ToolTabData[]; rangeLabel: string; rangeDays: number }) {
  // active = 0 → "All Tools" overview; active = i+1 → tools[i]
  const [active, setActive] = useState(0)
  if (tools.length === 0) {
    return <p className="py-8 text-center text-sm text-mrhb-dark/50">No tool usage for this period.</p>
  }

  const totalUsers = tools.reduce((s, x) => s + x.users, 0) || 1
  const isAll = active === 0

  const tabButton = (label: string, index: number) => (
    <button
      key={label}
      type="button"
      onClick={() => setActive(index)}
      className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
        active === index
          ? 'bg-mrhb-blue text-mrhb-white shadow-sm'
          : 'bg-mrhb-white text-mrhb-dark/70 ring-1 ring-mrhb-warm-grey/20 hover:bg-mrhb-blue-light'
      }`}
    >
      {label}
    </button>
  )

  return (
    <div>
      {/* Tabs: All Tools first, then one per tool (ordered by usage) */}
      <div className="mb-4 flex flex-wrap gap-2">
        {tabButton('All Tools', 0)}
        {tools.map((x, i) => tabButton(x.tool, i + 1))}
      </div>

      {isAll ? (
        <AllToolsOverview tools={tools} totalUsers={totalUsers} rangeDays={rangeDays} />
      ) : (
        <ToolDetail tool={tools[Math.min(active - 1, tools.length - 1)]} totalUsers={totalUsers} rangeLabel={rangeLabel} rangeDays={rangeDays} />
      )}
    </div>
  )
}

function AllToolsOverview({ tools, totalUsers, rangeDays }: { tools: ToolTabData[]; totalUsers: number; rangeDays: number }) {
  const bars: BarChartDataPoint[] = tools.map((t) => ({ label: t.tool, value: t.users }))
  const rows = tools.map((t) => ({
    tool: t.tool,
    users: formatNumber(t.users),
    avgDaily: fmtAvg(avgDaily(t.users, rangeDays)),
    events: formatNumber(t.events),
    platform: `${formatNumber(t.android)} / ${formatNumber(t.ios)} / ${formatNumber(t.web)}`,
    share: formatPercent((t.users / totalUsers) * 100),
  }))
  return (
    <div>
      <BarChart data={bars} title="Active Users by Tool" color="#01A6FA" valueLabel="Active Users" height={360} layout="horizontal" />
      <div className="mt-4">
        <DataTable columns={OVERVIEW_COLUMNS} data={rows} title="All Tools — Detail" emptyMessage="No tool usage for this period." />
      </div>
    </div>
  )
}

function ToolDetail({ tool: t, totalUsers, rangeLabel, rangeDays }: { tool: ToolTabData; totalUsers: number; rangeLabel: string; rangeDays: number }) {
  const platTotal = t.android + t.ios + t.web || 1
  const trend: AreaChartDataPoint[] = t.trend.map((p) => ({ date: shortDate(p.date), value: p.users, secondaryValue: p.events }))
  const avg = avgDaily(t.users, rangeDays)
  const platformRows = [
    { k: 'Android', v: t.android },
    { k: 'iOS', v: t.ios },
    { k: 'Web', v: t.web },
  ]
  return (
    <div>
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard
          title="Active Users"
          value={formatNumber(t.users)}
          iconName="users"
          tooltip={`Active users of ${t.tool} for ${rangeLabel} (summed daily active — a ceiling, not unique-in-period).`}
        />
        <KPICard
          title="Avg Daily Users"
          value={fmtAvg(avg)}
          iconName="clock"
          tooltip={`Average active users per day: ${t.tool}'s summed daily active (${formatNumber(t.users)}) ÷ ${rangeDays} day${rangeDays === 1 ? '' : 's'} in ${rangeLabel}.`}
        />
        <KPICard
          title="Events"
          value={formatNumber(t.events)}
          iconName="mouse-pointer-click"
          tooltip={`All ${t.tool} events (screens + actions, all platforms) for ${rangeLabel}.`}
        />
        <KPICard
          title="Share of Tool Usage"
          value={formatPercent((t.users / totalUsers) * 100)}
          iconName="trophy"
          tooltip={`${t.tool}'s share of active users across all tracked tools.`}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-xl bg-mrhb-white p-5 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold text-mrhb-dark">Platform split</h3>
          {platformRows.map((row) => (
            <div key={row.k} className="mb-2.5 last:mb-0">
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="text-mrhb-dark/70">{row.k}</span>
                <span className="text-mrhb-dark/50">
                  {formatNumber(row.v)} &middot; {((row.v / platTotal) * 100).toFixed(0)}%
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-mrhb-blue-light">
                <div className="h-full rounded-full bg-mrhb-blue" style={{ width: `${(row.v / platTotal) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>

        <div className="lg:col-span-2">
          <AreaChart
            data={trend}
            title={`${t.tool} — daily engagement (${rangeLabel})`}
            color="#01A6FA"
            fillColor="#D0EFFF"
            seriesLabel="Active Users"
            secondarySeriesLabel="Events"
            secondaryColor="#E5B897"
            height={300}
          />
        </div>
      </div>
    </div>
  )
}
