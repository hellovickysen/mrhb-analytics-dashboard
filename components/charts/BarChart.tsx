'use client'

import {
  ResponsiveContainer,
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  type TooltipProps,
} from 'recharts'

export interface BarChartDataPoint {
  label: string
  value: number
  secondaryValue?: number
}

export type BarChartLayout = 'vertical' | 'horizontal'

export interface BarChartProps {
  data: BarChartDataPoint[]
  title?: string
  color?: string
  secondaryColor?: string
  height?: number
  /** 'vertical' = upright bars (category axis horizontal); 'horizontal' = bars lie flat (category axis vertical). Default 'vertical'. */
  layout?: BarChartLayout
  /** Stack the primary/secondary series into a single bar instead of grouping them side by side. Default false. */
  stacked?: boolean
  valueLabel?: string
  secondaryValueLabel?: string
}

function formatTick(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(0)}k` : `${value}`
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
          className="flex items-center gap-2 text-sm font-semibold text-mrhb-dark"
        >
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          {entry.value?.toLocaleString()}
          <span className="font-medium text-mrhb-dark/50">{entry.name}</span>
        </p>
      ))}
    </div>
  )
}

export default function BarChart({
  data,
  title,
  color = '#01A6FA',
  secondaryColor = '#E5B897',
  height = 320,
  layout = 'vertical',
  stacked = false,
  valueLabel = 'Value',
  secondaryValueLabel = 'Secondary',
}: BarChartProps) {
  const hasSecondary = data.some((point) => typeof point.secondaryValue === 'number')
  // Recharts' `layout` prop is inverted relative to this component's naming:
  // our 'vertical' (upright bars) maps to Recharts' 'horizontal' layout, and
  // vice versa. Translate once here so the rest of the file stays readable.
  const rechartsLayout = layout === 'vertical' ? 'horizontal' : 'vertical'
  const stackId = stacked ? 'stack' : undefined

  return (
    <div className="rounded-xl bg-mrhb-white p-5 shadow-sm">
      {title && (
        <h3 className="mb-4 text-base font-semibold text-mrhb-dark">{title}</h3>
      )}

      <ResponsiveContainer width="100%" height={height}>
        <RechartsBarChart
          data={data}
          layout={rechartsLayout}
          margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
          barGap={4}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="#BFB4A6"
            strokeOpacity={0.25}
            horizontal={rechartsLayout === 'horizontal'}
            vertical={rechartsLayout === 'vertical'}
          />

          {rechartsLayout === 'horizontal' ? (
            <>
              <XAxis
                dataKey="label"
                tick={{ fill: '#29231D', fontSize: 12, fontFamily: 'Syne' }}
                tickLine={false}
                axisLine={{ stroke: '#BFB4A6', strokeOpacity: 0.3 }}
              />
              <YAxis
                tick={{ fill: '#29231D', fontSize: 12, fontFamily: 'Syne' }}
                tickLine={false}
                axisLine={false}
                width={48}
                tickFormatter={formatTick}
              />
            </>
          ) : (
            <>
              <XAxis
                type="number"
                tick={{ fill: '#29231D', fontSize: 12, fontFamily: 'Syne' }}
                tickLine={false}
                axisLine={{ stroke: '#BFB4A6', strokeOpacity: 0.3 }}
                tickFormatter={formatTick}
              />
              <YAxis
                type="category"
                dataKey="label"
                tick={{ fill: '#29231D', fontSize: 12, fontFamily: 'Syne' }}
                tickLine={false}
                axisLine={false}
                width={120}
              />
            </>
          )}

          <Tooltip content={<CustomTooltip />} cursor={{ fill: '#D0EFFF', opacity: 0.3 }} />
          {hasSecondary && (
            <Legend
              wrapperStyle={{ fontSize: 12, fontFamily: 'Syne', color: '#29231D' }}
            />
          )}

          <Bar
            dataKey="value"
            name={valueLabel}
            fill={color}
            radius={rechartsLayout === 'horizontal' ? ([4, 4, 0, 0] as const) : ([0, 4, 4, 0] as const)}
            stackId={stackId}
            maxBarSize={48}
          />
          {hasSecondary && (
            <Bar
              dataKey="secondaryValue"
              name={secondaryValueLabel}
              fill={secondaryColor}
              radius={rechartsLayout === 'horizontal' ? ([4, 4, 0, 0] as const) : ([0, 4, 4, 0] as const)}
              stackId={stackId}
              maxBarSize={48}
            />
          )}
        </RechartsBarChart>
      </ResponsiveContainer>
    </div>
  )
}
