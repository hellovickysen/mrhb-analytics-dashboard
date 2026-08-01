'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import { MRHB_LOGO } from '@/lib/utils/logo'
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
  X,
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

/** Human-friendly relative time from an ISO timestamp (e.g. "5 minutes ago"). */
function relTime(iso: string | null): string {
  if (!iso) return 'no syncs yet'
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return '—'
  const seconds = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days > 1 ? 's' : ''} ago`
}

interface SidebarProps {
  onClose?: () => void
}

export default function Sidebar({ onClose }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [isSyncing, setIsSyncing] = useState(false)
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)
  const [syncLoaded, setSyncLoaded] = useState(false)
  const [syncFailed, setSyncFailed] = useState(false)
  const [userName, setUserName] = useState('')

  useEffect(() => {
    setUserName(getUserName())
  }, [])

  // Load the real last-successful-sync time from data_sync_log on mount.
  const loadLastSync = () => {
    fetch('/api/last-sync', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        setLastSyncedAt(d?.lastSyncedAt ?? null)
        setSyncLoaded(true)
      })
      .catch(() => {
        setSyncLoaded(true)
      })
  }

  useEffect(() => {
    loadLastSync()
  }, [])

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/'
    return pathname === href || pathname?.startsWith(`${href}/`)
  }

  const handleSync = () => {
    setIsSyncing(true)
    setSyncFailed(false)
    fetch('/api/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'all', daysBack: 7 }),
    })
      .then((r) => r.json())
      .then(() => {
        setIsSyncing(false)
        setLastSyncedAt(new Date().toISOString())
        setSyncLoaded(true)
        // Re-read the page data so freshly-synced numbers appear immediately.
        router.refresh()
      })
      .catch(() => {
        setIsSyncing(false)
        setSyncFailed(true)
      })
  }

  const syncLabel = syncFailed
    ? 'sync failed'
    : !syncLoaded
      ? 'checking…'
      : relTime(lastSyncedAt)

  const handleLogout = () => {
    document.cookie = 'mrhb_user=; path=/; max-age=0'
    router.push('/login')
    router.refresh()
  }

  const handleNavClick = () => {
    // Close sidebar on mobile after navigation
    onClose?.()
  }

  return (
    <aside className="flex h-[100dvh] w-[260px] flex-col bg-mrhb-dark">
      {/* Logo area */}
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-5">
        <div className="flex items-center gap-3">
          <img src={MRHB_LOGO} alt="MRHB" className="h-9 w-9 rounded-lg" />
          <div>
            <h1 className="font-syne text-lg font-bold tracking-tight text-white">MRHB</h1>
            <p className="font-syne text-[10px] font-medium tracking-widest text-[#01A6FA]">ANALYTICS</p>
          </div>
        </div>
        {/* Close button — mobile only */}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-mrhb-warm-grey hover:bg-white/10 hover:text-white lg:hidden"
          >
            <X size={18} />
          </button>
        )}
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
                  onClick={handleNavClick}
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

      {/* Bottom section: user + sync combined for compact mobile fit */}
      <div className="flex-shrink-0 border-t border-white/10">
        {/* User + logout row */}
        {userName && (
          <div className="flex items-center justify-between px-4 py-2.5">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#01A6FA] to-[#0180c0] text-xs font-bold text-white">
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
        )}

        {/* Sync row */}
        <div className="flex items-center gap-2 px-4 py-2.5">
          <button
            type="button"
            onClick={handleSync}
            disabled={isSyncing}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-mrhb-blue/10 px-3 py-2 text-sm font-medium text-mrhb-blue transition-colors hover:bg-mrhb-blue/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
            {isSyncing ? 'Syncing...' : 'Sync'}
          </button>
          <span className="text-[10px] text-mrhb-warm-grey">{syncLabel}</span>
        </div>
      </div>
    </aside>
  )
}
