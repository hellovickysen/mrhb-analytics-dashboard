'use client'

import {
  ResponsiveContainer,
  LineChart as RechartsLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  type TooltipProps,
} from 'recharts'

export interface LineChartDataPoint {
  date: string
  value: number
}

interface LineChartProps {
  data: LineChartDataPoint[]
  title?: string
  color?: string
  height?: number
}

function CustomTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null

  return (
    <div className="rounded-lg border border-mrhb-warm-grey/30 bg-mrhb-white px-3 py-2 shadow-md">
      <p className="text-xs font-medium text-mrhb-dark/60">{label}</p>
      <p className="text-sm font-semibold text-mrhb-dark">
        {payload[0].value?.toLocaleString()}
      </p>
    </div>
  )
}

export default function LineChart({
  data,
  title,
  color = '#01A6FA',
  height = 320,
}: LineChartProps) {
  return (
    <div className="rounded-xl bg-mrhb-white p-5 shadow-sm">
      {title && (
        <h3 className="mb-4 text-base font-semibold text-mrhb-dark">{title}</h3>
      )}

      <ResponsiveContainer width="100%" height={height}>
        <RechartsLineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="#BFB4A6"
            strokeOpacity={0.25}
            vertical={false}
          />
          <XAxis
            dataKey="date"
            tick={{ fill: '#29231D', fontSize: 12, fontFamily: 'Syne' }}
            tickLine={false}
            axisLine={{ stroke: '#BFB4A6', strokeOpacity: 0.3 }}
          />
          <YAxis
            tick={{ fill: '#29231D', fontSize: 12, fontFamily: 'Syne' }}
            tickLine={false}
            axisLine={false}
            width={48}
            tickFormatter={(value: number) =>
              value >= 1000 ? `${(value / 1000).toFixed(0)}k` : `${value}`
            }
          />
          <Tooltip content={<CustomTooltip />} />
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 5, fill: color, strokeWidth: 0 }}
          />
        </RechartsLineChart>
      </ResponsiveContainer>
    </div>
  )
}
