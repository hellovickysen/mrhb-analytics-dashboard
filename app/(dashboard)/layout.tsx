'use client'

import { useState } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import { Menu, X } from 'lucide-react'
import { MRHB_LOGO } from '@/lib/utils/logo'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="flex h-screen overflow-hidden bg-mrhb-cream">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — hidden on mobile, shown on lg+ */}
      <div
        className={`fixed inset-y-0 left-0 z-50 w-[260px] transform transition-transform duration-300 ease-in-out lg:relative lg:translate-x-0 lg:transition-none ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <Sidebar onClose={() => setSidebarOpen(false)} />
      </div>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto bg-mrhb-cream px-4 py-4 sm:px-6 sm:py-5 lg:px-8 lg:py-6">
        {/* Mobile header with hamburger */}
        <div className="mb-4 flex items-center gap-3 lg:hidden">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="flex h-10 w-10 items-center justify-center rounded-lg bg-mrhb-dark text-white shadow-sm"
          >
            <Menu size={20} />
          </button>
          <img src={MRHB_LOGO} alt="MRHB" className="h-9 w-9 rounded-lg" />
          <div>
            <h1 className="font-syne text-lg font-bold text-mrhb-dark">MRHB</h1>
            <p className="font-syne text-[10px] tracking-widest text-mrhb-blue">ANALYTICS</p>
          </div>
        </div>
        {children}
      </main>
    </div>
  )
}
