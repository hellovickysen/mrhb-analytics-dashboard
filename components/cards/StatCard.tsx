'use client'

export interface StatCardProps {
  label: string
  value: string | number
  subtext?: string
  className?: string
}

/**
 * Lightweight stat display — no icon, no trend arrow. Compact footprint
 * (smaller padding/type scale than KPICard) for dense grids of secondary
 * metrics where a full KPICard would be too heavy.
 */
export default function StatCard({ label, value, subtext, className = '' }: StatCardProps) {
  return (
    <div
      className={`rounded-lg border border-mrhb-warm-grey/20 bg-mrhb-white p-4 ${className}`}
    >
      <p className="text-xs font-medium text-mrhb-dark/50">{label}</p>
      <p className="mt-1 text-lg font-bold text-mrhb-dark">{value}</p>
      {subtext && <p className="mt-0.5 text-xs text-mrhb-dark/60">{subtext}</p>}
    </div>
  )
}
