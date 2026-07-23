'use client'

export interface Tab {
  id: string
  label: string
}

export interface TabsProps {
  tabs: Tab[]
  activeTab: string
  onTabChange: (tabId: string) => void
  className?: string
}

export default function Tabs({ tabs, activeTab, onTabChange, className = '' }: TabsProps) {
  return (
    <div
      role="tablist"
      className={`flex items-center gap-6 border-b border-mrhb-warm-grey/25 ${className}`}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab

        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onTabChange(tab.id)}
            className={`relative pb-3 text-sm font-medium transition-colors ${
              isActive ? 'text-mrhb-blue' : 'text-mrhb-dark/60 hover:text-mrhb-dark'
            }`}
          >
            {tab.label}
            {isActive && (
              <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-mrhb-blue" />
            )}
          </button>
        )
      })}
    </div>
  )
}
