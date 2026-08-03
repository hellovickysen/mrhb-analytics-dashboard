'use client'

import { useState } from 'react'
import { formatNumber } from '@/lib/utils/format'
import {
  ArrowUp,
  ArrowDown,
  Minus,
  Users,
  Smartphone,
  MousePointerClick,
  Share2,
  ScrollText,
  DollarSign,
  TrendingUp,
  Search,
  FileText,
  Filter,
  Settings,
  Globe,
  Clock,
  Trophy,
  AlertTriangle,
  Repeat,
  UserPlus,
  type LucideIcon,
} from 'lucide-react'

export type Trend = 'up' | 'down' | 'flat'

// Icon lookup map — KPICard resolves icons by name so Server Components can
// reference them without passing a function across the RSC boundary.
const ICON_MAP: Record<string, LucideIcon> = {
  users: Users,
  smartphone: Smartphone,
  'mouse-pointer-click': MousePointerClick,
  share2: Share2,
  'scroll-text': ScrollText,
  'dollar-sign': DollarSign,
  'trending-up': TrendingUp,
  search: Search,
  'file-text': FileText,
  filter: Filter,
  settings: Settings,
  globe: Globe,
  clock: Clock,
  trophy: Trophy,
  'alert-triangle': AlertTriangle,
  repeat: Repeat,
  'user-plus': UserPlus,
}

interface KPICardProps {
  title: string
  value: string | number
  /** Percentage change vs the previous period. */
  change?: number
  /** Absolute change vs the previous period (signed). Shown next to the % as
   * e.g. "+1,234" / "−230" so managers see both the rate and the raw movement. */
  changeValue?: number
  trend?: Trend
  iconName: string
  tooltip?: string
}

const TREND_STYLES: Record<
  Trend,
  { textClass: string; Icon: LucideIcon }
> = {
  up: { textClass: 'text-emerald-600', Icon: ArrowUp },
  down: { textClass: 'text-red-500', Icon: ArrowDown },
  flat: { textClass: 'text-mrhb-warm-grey', Icon: Minus },
}

/** Formats a signed delta with a thousands separator and an explicit +/− sign
 * (true minus glyph). Large magnitudes round to whole numbers (e.g. "+1,234");
 * small magnitudes keep one decimal so rate/rating/position deltas don't
 * collapse to "±0" (e.g. a 0.15 pp move → "+0.2"). */
function formatSignedDelta(delta: number): string {
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '±'
  const abs = Math.abs(delta)
  const num = abs >= 10 ? Math.round(abs).toLocaleString('en-US') : abs.toFixed(1)
  return `${sign}${num}`
}

export default function KPICard({
  title,
  value,
  change,
  changeValue,
  trend = 'flat',
  iconName,
  tooltip,
}: KPICardProps) {
  const { textClass, Icon: TrendIcon } = TREND_STYLES[trend]
  const Icon = ICON_MAP[iconName] ?? Users
  const [showTooltip, setShowTooltip] = useState(false)

  const hasChange = typeof change === 'number'
  const hasDelta = typeof changeValue === 'number' && Number.isFinite(changeValue)

  // Recover the previous-period value from the two props we already have:
  // delta = current − previous and pct = delta / previous, so
  // previous = delta ÷ (pct/100). No extra data needed on the page.
  const previousValue =
    hasChange && hasDelta && (change as number) !== 0
      ? (changeValue as number) / ((change as number) / 100)
      : undefined
  const hasPrevious = typeof previousValue === 'number' && Number.isFinite(previousValue)

  return (
    <div className="group relative rounded-xl bg-mrhb-white p-5 shadow-sm transition-shadow duration-200 hover:shadow-lg">
      <div className="flex items-start justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-mrhb-blue-light">
          <Icon size={20} className="text-mrhb-blue" />
        </div>

        {(hasChange || hasDelta) && (
          <div className={`flex flex-col items-end gap-0.5 ${textClass}`}>
            {hasChange && (
              <div className="flex items-center gap-1 text-sm font-medium">
                <TrendIcon size={14} />
                <span>{Math.abs(change as number).toFixed(1)}%</span>
              </div>
            )}
            {hasDelta && (
              <span className="text-xs font-medium tabular-nums opacity-90">
                {formatSignedDelta(changeValue as number)}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center gap-1.5">
        <p className="text-sm font-medium text-mrhb-dark/60">{title}</p>
        {tooltip && (
          <div className="relative">
            <button
              type="button"
              onMouseEnter={() => setShowTooltip(true)}
              onMouseLeave={() => setShowTooltip(false)}
              onClick={() => setShowTooltip(!showTooltip)}
              className="flex h-4 w-4 items-center justify-center rounded-full bg-mrhb-dark/10 text-[10px] font-bold text-mrhb-dark/40 hover:bg-mrhb-blue/20 hover:text-mrhb-blue"
            >
              ?
            </button>
            {showTooltip && (
              <div className="absolute bottom-full left-1/2 z-50 mb-2 w-52 -translate-x-1/2 rounded-lg bg-mrhb-dark px-3 py-2 text-xs leading-relaxed text-white shadow-lg">
                {tooltip}
                <div className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-mrhb-dark" />
              </div>
            )}
          </div>
        )}
      </div>
      <p className="mt-1 text-2xl font-semibold text-mrhb-dark">{value}</p>
      {hasPrevious && (
        <p className="mt-0.5 text-[11px] text-mrhb-dark/40">
          vs {formatNumber(Math.round(previousValue as number))} previous period
        </p>
      )}
    </div>
  )
}
