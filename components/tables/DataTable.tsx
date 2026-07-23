'use client'

import { useMemo, useState } from 'react'
import { ArrowUp, ArrowDown, ChevronsUpDown } from 'lucide-react'

export type DataTableAlign = 'left' | 'right' | 'center'

export interface DataTableColumn<T> {
  /** Key into each row object this column renders. */
  key: keyof T & string
  label: string
  sortable?: boolean
  align?: DataTableAlign
}

export interface DataTableProps<T extends Record<string, unknown>> {
  columns: DataTableColumn<T>[]
  data: T[]
  title?: string
  emptyMessage?: string
}

type SortDirection = 'asc' | 'desc'

const ALIGN_CLASS: Record<DataTableAlign, string> = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
}

export default function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  title,
  emptyMessage = 'No data available.',
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<(keyof T & string) | null>(null)
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')

  const sortedData = useMemo(() => {
    if (!sortKey) return data

    const copy = [...data]
    copy.sort((a, b) => {
      const aVal = a[sortKey]
      const bVal = b[sortKey]

      let comparison = 0
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        comparison = aVal - bVal
      } else {
        comparison = String(aVal ?? '').localeCompare(String(bVal ?? ''))
      }

      return sortDirection === 'asc' ? comparison : -comparison
    })
    return copy
  }, [data, sortKey, sortDirection])

  const handleSort = (column: DataTableColumn<T>) => {
    if (!column.sortable) return

    if (sortKey === column.key) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(column.key)
      setSortDirection('desc')
    }
  }

  return (
    <div className="rounded-xl bg-mrhb-white p-5 shadow-sm">
      {title && (
        <h3 className="mb-4 text-base font-semibold text-mrhb-dark">{title}</h3>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-mrhb-warm-grey/25">
              {columns.map((column) => {
                const isActive = sortKey === column.key
                return (
                  <th
                    key={column.key}
                    scope="col"
                    className={`whitespace-nowrap px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-mrhb-dark/50 ${
                      ALIGN_CLASS[column.align ?? 'left']
                    } ${column.sortable ? 'cursor-pointer select-none hover:text-mrhb-blue' : ''}`}
                    onClick={() => handleSort(column)}
                  >
                    <span
                      className={`inline-flex items-center gap-1 ${
                        column.align === 'right'
                          ? 'flex-row-reverse'
                          : column.align === 'center'
                            ? 'justify-center'
                            : ''
                      }`}
                    >
                      {column.label}
                      {column.sortable && (
                        <span className={isActive ? 'text-mrhb-blue' : 'text-mrhb-dark/30'}>
                          {isActive ? (
                            sortDirection === 'asc' ? (
                              <ArrowUp size={12} />
                            ) : (
                              <ArrowDown size={12} />
                            )
                          ) : (
                            <ChevronsUpDown size={12} />
                          )}
                        </span>
                      )}
                    </span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {sortedData.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-3 py-8 text-center text-sm text-mrhb-dark/50"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              sortedData.map((row, rowIndex) => (
                <tr
                  key={rowIndex}
                  className={`transition-colors hover:bg-mrhb-blue-light/40 ${
                    rowIndex % 2 === 0 ? 'bg-mrhb-white' : 'bg-mrhb-cream'
                  }`}
                >
                  {columns.map((column) => {
                    const value = row[column.key]
                    return (
                      <td
                        key={column.key}
                        className={`whitespace-nowrap px-3 py-2.5 text-mrhb-dark ${
                          ALIGN_CLASS[column.align ?? 'left']
                        }`}
                      >
                        {value === null || value === undefined || value === ''
                          ? '—'
                          : String(value)}
                      </td>
                    )
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
