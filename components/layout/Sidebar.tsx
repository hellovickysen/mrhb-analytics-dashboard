'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import {
  LayoutDashboard,
  TrendingUp,
  Filter,
  MousePointerClick,
  Share2,
  Smartphone,
  Search,
  FileText,
  DollarSign,
  Settings,
  RefreshCw,
  type LucideIcon,
} from 'lucide-react'

interface NavItem {
  label: string
  href: string
  icon: LucideIcon
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Overview', href: '/', icon: LayoutDashboard },
  { label: 'Traffic', href: '/traffic', icon: TrendingUp },
  { label: 'User Funnel', href: '/funnel', icon: Filter },
  { label: 'UX & Friction', href: '/ux', icon: MousePointerClick },
  { label: 'Social & Campaigns', href: '/social', icon: Share2 },
  { label: 'App Performance', href: '/app-performance', icon: Smartphone },
  { label: 'SEO', href: '/seo', icon: Search },
  { label: 'Blog', href: '/blog', icon: FileText },
  { label: 'Revenue', href: '/revenue', icon: DollarSign },
  { label: 'Admin', href: '/admin', icon: Settings },
]

export default function Sidebar() {
  const pathname = usePathname()
  const [isSyncing, setIsSyncing] = useState(false)
  const [lastSynced, setLastSynced] = useState('2 minutes ago')

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/'
    return pathname === href || pathname?.startsWith(`${href}/`)
  }

  const handleSync = () => {
    setIsSyncing(true)
    // Placeholder sync action — wire up to a real data-refresh endpoint later.
    setTimeout(() => {
      setIsSyncing(false)
      setLastSynced('just now')
    }, 1500)
  }

  return (
    <aside className="flex h-screen w-[260px] flex-col bg-mrhb-dark">
      {/* Logo area */}
      <div className="flex items-center gap-2 border-b border-white/10 px-6 py-6">
        <div className="flex items-baseline gap-1">
          <span className="text-2xl font-bold text-mrhb-blue">MRHB</span>
        </div>
      </div>
      <div className="px-6 pb-4 pt-3 -mt-2">
        <span className="text-xs font-medium uppercase tracking-wider text-mrhb-warm-grey">
          Analytics
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-2">
        <ul className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const active = isActive(item.href)
            const Icon = item.icon

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`group flex items-center gap-3 rounded-md border-l-[3px] px-3 py-2.5 text-sm transition-colors ${
                    active
                      ? 'border-mrhb-blue bg-white/10 font-semibold text-white'
                      : 'border-transparent text-mrhb-warm-grey hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <Icon
                    size={18}
                    className={
                      active
                        ? 'text-mrhb-blue'
                        : 'text-mrhb-warm-grey group-hover:text-mrhb-blue'
                    }
                  />
                  <span>{item.label}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* Bottom section */}
      <div className="border-t border-white/10 px-4 py-4">
        <p className="mb-2 text-xs text-mrhb-warm-grey">
          Last synced: <span className="text-white/80">{lastSynced}</span>
        </p>
        <button
          type="button"
          onClick={handleSync}
          disabled={isSyncing}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-mrhb-blue/10 px-3 py-2 text-sm font-medium text-mrhb-blue transition-colors hover:bg-mrhb-blue/20 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw
            size={14}
            className={isSyncing ? 'animate-spin' : ''}
          />
          {isSyncing ? 'Syncing…' : 'Sync now'}
        </button>
      </div>
    </aside>
  )
}
