'use client'

import { useState } from 'react'
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
}

interface KPICardProps {
  title: string
  value: string | number
  change?: number
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

export default function KPICard({
  title,
  value,
  change,
  trend = 'flat',
  iconName,
  tooltip,
}: KPICardProps) {
  const { textClass, Icon: TrendIcon } = TREND_STYLES[trend]
  const Icon = ICON_MAP[iconName] ?? Users
  const [showTooltip, setShowTooltip] = useState(false)

  return (
    <div className="group relative rounded-xl bg-mrhb-white p-5 shadow-sm transition-shadow duration-200 hover:shadow-lg">
      <div className="flex items-center justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-mrhb-blue-light">
          <Icon size={20} className="text-mrhb-blue" />
        </div>

        {typeof change === 'number' && (
          <div className={`flex items-center gap-1 text-sm font-medium ${textClass}`}>
            <TrendIcon size={14} />
            <span>{Math.abs(change).toFixed(1)}%</span>
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
    </div>
  )
}
