'use client'

import {
  ResponsiveContainer,
  AreaChart as RechartsAreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  type TooltipProps,
} from 'recharts'

export interface AreaChartDataPoint {
  date: string
  value: number
  secondaryValue?: number
}

export interface AreaChartProps {
  data: AreaChartDataPoint[]
  title?: string
  color?: string
  /** Lighter fill color for the gradient below the primary line. Defaults to mrhb-blue-light. */
  fillColor?: string
  /** Optional label for the primary series, shown in the tooltip/legend. */
  seriesLabel?: string
  /** Optional label + colors for the secondary series (when `secondaryValue` is present). */
  secondarySeriesLabel?: string
  secondaryColor?: string
  secondaryFillColor?: string
  height?: number
}

function formatAxisValue(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1000) return `${(value / 1000).toFixed(0)}k`
  return `${value}`
}

function CustomTooltip({
  active,
  payload,
  label,
}: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null

  return (
    <div className="rounded-lg border border-mrhb-warm-grey/30 bg-mrhb-white px-3 py-2 shadow-md">
      <p className="mb-1 text-xs font-medium text-mrhb-dark/60">{label}</p>
      {payload.map((entry, index) => (
        <p
          key={`${entry.name ?? 'series'}-${index}`}
          className="text-sm font-semibold text-mrhb-dark"
          style={{ color: entry.color }}
        >
          {entry.name}: {entry.value?.toLocaleString()}
        </p>
      ))}
    </div>
  )
}

export default function AreaChart({
  data,
  title,
  color = '#01A6FA',
  fillColor = '#D0EFFF',
  seriesLabel = 'Value',
  secondarySeriesLabel = 'Secondary',
  secondaryColor = '#E5B897',
  secondaryFillColor = '#E5B897',
  height = 320,
}: AreaChartProps) {
  const hasSecondary = data.some((d) => typeof d.secondaryValue === 'number')

  return (
    <div className="rounded-xl bg-mrhb-white p-5 shadow-sm">
      {title && (
        <h3 className="mb-4 text-base font-semibold text-mrhb-dark">{title}</h3>
      )}

      <ResponsiveContainer width="100%" height={height}>
        <RechartsAreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="areaFillPrimary" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={fillColor} stopOpacity={0.8} />
              <stop offset="95%" stopColor={fillColor} stopOpacity={0.05} />
            </linearGradient>
            <linearGradient id="areaFillSecondary" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={secondaryFillColor} stopOpacity={0.5} />
              <stop offset="95%" stopColor={secondaryFillColor} stopOpacity={0.05} />
            </linearGradient>
          </defs>
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
            tickFormatter={formatAxisValue}
          />
          <Tooltip content={<CustomTooltip />} />
          {hasSecondary && (
            <Legend
              wrapperStyle={{ fontSize: 12, fontFamily: 'Syne', color: '#29231D' }}
              iconType="circle"
            />
          )}
          {/* Secondary series renders first (underneath); primary renders last (on top) so it stays visually dominant. */}
          {hasSecondary && (
            <Area
              type="monotone"
              dataKey="secondaryValue"
              name={secondarySeriesLabel}
              stroke={secondaryColor}
              strokeWidth={2}
              fill="url(#areaFillSecondary)"
              dot={false}
              activeDot={{ r: 4, fill: secondaryColor, strokeWidth: 0 }}
            />
          )}
          <Area
            type="monotone"
            dataKey="value"
            name={seriesLabel}
            stroke={color}
            strokeWidth={2.5}
            fill="url(#areaFillPrimary)"
            dot={false}
            activeDot={{ r: 5, fill: color, strokeWidth: 0 }}
          />
        </RechartsAreaChart>
      </ResponsiveContainer>
    </div>
  )
}
