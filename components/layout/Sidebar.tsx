'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
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
  LogOut,
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

function getUserName(): string {
  if (typeof document === 'undefined') return ''
  const match = document.cookie.match(/mrhb_user=([^;]+)/)
  return match ? decodeURIComponent(match[1]) : ''
}

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const [isSyncing, setIsSyncing] = useState(false)
  const [lastSynced, setLastSynced] = useState('2 minutes ago')
  const [userName, setUserName] = useState('')

  useEffect(() => {
    setUserName(getUserName())
  }, [])

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/'
    return pathname === href || pathname?.startsWith(`${href}/`)
  }

  const handleSync = () => {
    setIsSyncing(true)
    setTimeout(() => {
      setIsSyncing(false)
      setLastSynced('just now')
    }, 1500)
  }

  const handleLogout = () => {
    document.cookie = 'mrhb_user=; path=/; max-age=0'
    router.push('/login')
    router.refresh()
  }

  return (
    <aside className="flex h-screen w-[260px] flex-col bg-mrhb-dark">
      {/* Logo area */}
      <div className="flex items-center gap-3 border-b border-white/10 px-6 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-[#01A6FA] to-[#0180c0]">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M3 3h7v7H3V3zm11 0h7v7h-7V3zM3 14h7v7H3v-7zm14 3.5a3.5 3.5 0 11-7 0 3.5 3.5 0 017 0z" fill="white" fillOpacity="0.9"/>
          </svg>
        </div>
        <div>
          <h1 className="font-syne text-lg font-bold tracking-tight text-white">
            MRHB
          </h1>
          <p className="font-syne text-[10px] font-medium tracking-widest text-[#01A6FA]">
            ANALYTICS
          </p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const active = isActive(item.href)
            const Icon = item.icon

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`group flex items-center gap-3 rounded-lg border-l-[3px] px-3 py-2.5 text-sm transition-colors ${
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

      {/* Sync section */}
      <div className="border-t border-white/10 px-4 py-3">
        <p className="mb-2 text-xs text-mrhb-warm-grey">
          Last synced: <span className="text-white/80">{lastSynced}</span>
        </p>
        <button
          type="button"
          onClick={handleSync}
          disabled={isSyncing}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-mrhb-blue/10 px-3 py-2 text-sm font-medium text-mrhb-blue transition-colors hover:bg-mrhb-blue/20 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw
            size={14}
            className={isSyncing ? 'animate-spin' : ''}
          />
          {isSyncing ? 'Syncing...' : 'Sync now'}
        </button>
      </div>

      {/* User section */}
      {userName && (
        <div className="border-t border-white/10 px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#01A6FA] to-[#0180c0] text-xs font-bold text-white">
                {userName.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-medium capitalize text-white">{userName}</p>
                <p className="text-[10px] text-mrhb-warm-grey">Team Member</p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              title="Logout"
              className="rounded-md p-1.5 text-mrhb-warm-grey transition-colors hover:bg-white/10 hover:text-red-400"
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
      )}
    </aside>
  )
}
