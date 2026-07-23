'use client'

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
}: KPICardProps) {
  const { textClass, Icon: TrendIcon } = TREND_STYLES[trend]
  const Icon = ICON_MAP[iconName] ?? Users

  return (
    <div className="group rounded-xl bg-mrhb-white p-5 shadow-sm transition-shadow duration-200 hover:shadow-lg">
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

      <p className="mt-4 text-sm font-medium text-mrhb-dark/60">{title}</p>
      <p className="mt-1 text-2xl font-semibold text-mrhb-dark">{value}</p>
    </div>
  )
}
