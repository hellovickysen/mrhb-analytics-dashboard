'use client'

import { useState, FormEvent } from 'react'
import { useRouter } from 'next/navigation'

const ALLOWED_NAMES = ['varun']

export default function LoginPage() {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')

    const trimmed = name.trim().toLowerCase()
    if (!trimmed) {
      setError('Please enter your name')
      return
    }

    if (!ALLOWED_NAMES.includes(trimmed)) {
      setError('Access denied. Contact admin for access.')
      return
    }

    setIsLoading(true)

    // Set auth cookie
    document.cookie = `mrhb_user=${encodeURIComponent(name.trim())}; path=/; max-age=${60 * 60 * 24 * 30}; SameSite=Lax`

    // Small delay for animation
    await new Promise((r) => setTimeout(r, 800))
    router.push('/')
    router.refresh()
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden">
      {/* Animated gradient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#29231D] via-[#1a1510] to-[#29231D]">
        {/* Animated orbs */}
        <div className="absolute left-1/4 top-1/4 h-[600px] w-[600px] animate-pulse rounded-full bg-[#01A6FA]/8 blur-[120px]" />
        <div className="absolute bottom-1/4 right-1/4 h-[500px] w-[500px] animate-pulse rounded-full bg-[#E5B897]/6 blur-[100px]" style={{ animationDelay: '2s' }} />
        <div className="absolute left-1/2 top-1/2 h-[400px] w-[400px] -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-full bg-[#D0EFFF]/5 blur-[80px]" style={{ animationDelay: '4s' }} />

        {/* Grid pattern overlay */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `linear-gradient(rgba(1,166,250,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(1,166,250,0.3) 1px, transparent 1px)`,
            backgroundSize: '60px 60px',
          }}
        />
      </div>

      {/* Login card */}
      <div className="relative z-10 w-full max-w-md px-6">
        {/* Logo & branding */}
        <div className="mb-10 text-center">
          <div className="mb-6 inline-flex items-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#01A6FA] to-[#0180c0] shadow-lg shadow-[#01A6FA]/20">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <path d="M3 3h7v7H3V3zm11 0h7v7h-7V3zM3 14h7v7H3v-7zm14 3.5a3.5 3.5 0 11-7 0 3.5 3.5 0 017 0z" fill="white" fillOpacity="0.9"/>
              </svg>
            </div>
            <div className="text-left">
              <h1 className="font-syne text-2xl font-bold tracking-tight text-white">
                MRHB
              </h1>
              <p className="font-syne text-xs font-medium tracking-widest text-[#01A6FA]">
                ANALYTICS
              </p>
            </div>
          </div>
          <p className="font-syne text-sm text-white/40">
            Management Dashboard
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.04] p-8 backdrop-blur-xl">
          <div className="mb-6">
            <h2 className="font-syne text-lg font-semibold text-white">
              Welcome back
            </h2>
            <p className="mt-1 text-sm text-white/40">
              Enter your name to access the dashboard
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label
                htmlFor="name"
                className="mb-2 block text-xs font-semibold uppercase tracking-wider text-white/30"
              >
                Your Name
              </label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  setError('')
                }}
                placeholder="Enter your name..."
                autoFocus
                autoComplete="off"
                className="w-full rounded-xl border border-white/10 bg-white/[0.06] px-4 py-3.5 font-syne text-white placeholder-white/20 outline-none transition-all duration-300 focus:border-[#01A6FA]/50 focus:bg-white/[0.08] focus:ring-2 focus:ring-[#01A6FA]/20"
              />
              {error && (
                <p className="mt-2 text-sm text-red-400">{error}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="group relative w-full overflow-hidden rounded-xl bg-gradient-to-r from-[#01A6FA] to-[#0180c0] px-4 py-3.5 font-syne text-sm font-semibold text-white shadow-lg shadow-[#01A6FA]/20 transition-all duration-300 hover:shadow-xl hover:shadow-[#01A6FA]/30 disabled:opacity-70"
            >
              <span className={`inline-flex items-center gap-2 transition-all duration-300 ${isLoading ? 'opacity-0' : 'opacity-100'}`}>
                Access Dashboard
                <svg className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </span>
              {isLoading && (
                <span className="absolute inset-0 flex items-center justify-center">
                  <svg className="h-5 w-5 animate-spin text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                </span>
              )}
            </button>
          </form>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center">
          <p className="text-xs text-white/20">
            Programmable Fintech for the Halal Economy
          </p>
          <div className="mt-3 flex items-center justify-center gap-4">
            <span className="h-1 w-1 rounded-full bg-[#01A6FA]/30" />
            <span className="text-[10px] tracking-widest text-white/15">MRHB NETWORK</span>
            <span className="h-1 w-1 rounded-full bg-[#01A6FA]/30" />
          </div>
        </div>
      </div>
    </div>
  )
}
