'use client'

import { useState } from 'react'
import KPICard from '@/components/cards/KPICard'
import AreaChart, { type AreaChartDataPoint } from '@/components/charts/AreaChart'
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

export default function ToolUsageTabs({ tools, rangeLabel }: { tools: ToolTabData[]; rangeLabel: string }) {
  const [active, setActive] = useState(0)
  if (tools.length === 0) {
    return <p className="py-8 text-center text-sm text-mrhb-dark/50">No tool usage for this period.</p>
  }

  const idx = Math.min(active, tools.length - 1)
  const t = tools[idx]
  const totalUsers = tools.reduce((s, x) => s + x.users, 0) || 1
  const platTotal = t.android + t.ios + t.web || 1
  const trend: AreaChartDataPoint[] = t.trend.map((p) => ({ date: shortDate(p.date), value: p.users, secondaryValue: p.events }))
  const platformRows = [
    { k: 'Android', v: t.android },
    { k: 'iOS', v: t.ios },
    { k: 'Web', v: t.web },
  ]

  return (
    <div>
      {/* Tabs (ordered by usage) */}
      <div className="mb-4 flex flex-wrap gap-2">
        {tools.map((x, i) => (
          <button
            key={x.tool}
            type="button"
            onClick={() => setActive(i)}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
              i === idx
                ? 'bg-mrhb-blue text-mrhb-white shadow-sm'
                : 'bg-mrhb-white text-mrhb-dark/70 ring-1 ring-mrhb-warm-grey/20 hover:bg-mrhb-blue-light'
            }`}
          >
            {x.tool}
          </button>
        ))}
      </div>

      {/* Cards for the active tool */}
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KPICard
          title="Active Users"
          value={formatNumber(t.users)}
          iconName="users"
          tooltip={`Active users of ${t.tool} for ${rangeLabel} (summed daily active — a ceiling, not unique-in-period).`}
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
        {/* Platform split */}
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

        {/* Per-tool trend */}
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
