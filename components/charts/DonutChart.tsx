'use client'

import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  type TooltipProps,
} from 'recharts'

export interface DonutChartDataPoint {
  name: string
  value: number
  color?: string
}

export interface DonutChartProps {
  data: DonutChartDataPoint[]
  title?: string
  height?: number
}

// Auto-assigned palette for slices that don't specify their own `color`.
// Cycles in order, starting with core MRHB brand colors before falling back
// to a couple of neutral accent colors for larger datasets.
const DEFAULT_COLORS = [
  '#01A6FA',
  '#29231D',
  '#E5B897',
  '#BFB4A6',
  '#D0EFFF',
  '#6366f1',
  '#f59e0b',
]

function getColor(point: DonutChartDataPoint, index: number): string {
  return point.color ?? DEFAULT_COLORS[index % DEFAULT_COLORS.length]
}

interface CustomTooltipProps extends TooltipProps<number, string> {
  total: number
}

function CustomTooltip({ active, payload, total }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null

  const entry = payload[0]
  const value = typeof entry.value === 'number' ? entry.value : 0
  const percentage = total > 0 ? (value / total) * 100 : 0

  return (
    <div className="rounded-lg border border-mrhb-warm-grey/30 bg-mrhb-white px-3 py-2 shadow-md">
      <p className="text-xs font-medium text-mrhb-dark/60">{entry.name}</p>
      <p className="text-sm font-semibold text-mrhb-dark">
        {value.toLocaleString()}{' '}
        <span className="font-medium text-mrhb-dark/50">
          ({percentage.toFixed(1)}%)
        </span>
      </p>
    </div>
  )
}

interface LegendPayloadEntry {
  value?: string
  color?: string
}

function CustomLegend({ payload }: { payload?: LegendPayloadEntry[] }) {
  if (!payload || payload.length === 0) return null

  return (
    <ul className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-2">
      {payload.map((entry, index) => (
        <li
          key={`${entry.value ?? 'entry'}-${index}`}
          className="flex items-center gap-1.5 text-xs font-medium text-mrhb-dark/70"
        >
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          {entry.value}
        </li>
      ))}
    </ul>
  )
}

export default function DonutChart({ data, title, height = 300 }: DonutChartProps) {
  const total = data.reduce((sum, point) => sum + point.value, 0)

  return (
    <div className="rounded-xl bg-mrhb-white p-5 shadow-sm">
      {title && (
        <h3 className="mb-4 text-base font-semibold text-mrhb-dark">{title}</h3>
      )}

      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius="60%"
            outerRadius="85%"
            paddingAngle={2}
            stroke="none"
          >
            {data.map((point, index) => (
              <Cell key={`${point.name}-${index}`} fill={getColor(point, index)} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip total={total} />} />
          <Legend content={<CustomLegend />} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}
