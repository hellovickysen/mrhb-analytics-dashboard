'use client'

import { useState } from 'react'
import { Download, Check } from 'lucide-react'
import { buildCsv, csvFilename, type CsvExportPayload } from '@/lib/utils/csv'

/**
 * Client-side CSV download button.
 *
 * The page (a server component) hands over a fully-serialisable payload built
 * from the SAME data it renders — no functions or components cross the
 * server/client boundary, and the export can never disagree with the screen.
 *
 * The file is generated in the browser from that payload, so there is no new
 * API route, no second query path, and no extra load on Supabase.
 */
interface ExportButtonProps {
  payload: CsvExportPayload
  /** Range key from the URL (today | yesterday | 7d | 30d | 90d) — filename only. */
  rangeKey: string
  /** Compact styling for placement inside the page Header. */
  compact?: boolean
}

export default function ExportButton({ payload, rangeKey, compact = false }: ExportButtonProps) {
  const [done, setDone] = useState(false)

  const handleExport = () => {
    const csv = buildCsv(payload, new Date().toISOString())

    // Prepend a UTF-8 BOM so Excel renders non-ASCII labels (country names,
    // campaign titles) correctly instead of mojibake.
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')

    link.href = url
    link.download = csvFilename(payload, rangeKey)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)

    setDone(true)
    setTimeout(() => setDone(false), 2000)
  }

  return (
    <button
      type="button"
      onClick={handleExport}
      title={`Download ${payload.pageTitle} as CSV (${payload.rangeLabel})`}
      className={`flex items-center gap-2 rounded-lg border border-mrhb-warm-grey/30 bg-mrhb-white font-medium text-mrhb-dark transition-colors hover:bg-mrhb-blue-light ${
        compact ? 'px-3 py-2 text-sm' : 'px-4 py-2 text-sm'
      }`}
    >
      {done ? (
        <Check size={16} className="text-mrhb-blue" />
      ) : (
        <Download size={16} />
      )}
      {done ? 'Downloaded' : 'Export CSV'}
    </button>
  )
}
