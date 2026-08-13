import { NextResponse } from 'next/server'
import { buildCsv, escapeCsvCell, csvFilename } from '@/lib/utils/csv'

/**
 * TEMPORARY read-only deploy self-test. Proves the CSV export module compiles
 * and behaves in the production runtime (a 307 on page routes cannot tell a new
 * build from the last-good one). Touches no data and no secrets.
 *
 * DELETE THIS ROUTE once the deploy is verified.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  const payload = {
    filename: 'mrhb-selftest',
    pageTitle: 'Self Test',
    rangeLabel: 'Last 30 Days',
    startDate: '2026-07-14',
    endDate: '2026-08-13',
    sample: true,
    sections: [
      {
        title: 'Block',
        columns: [
          { key: 'country', label: 'Country' },
          { key: 'users', label: 'Users' },
        ],
        rows: [
          { country: 'Dubai, UAE', users: 16920 },
          { country: '=cmd', users: -12.5 },
        ],
      },
    ],
  }

  const csv = buildCsv(payload, '2026-08-13T00:00:00.000Z')

  return NextResponse.json({
    marker: 'csv-export-v1',
    filename: csvFilename(payload, '30d'),
    sampleMarkerPresent: csv.indexOf('SAMPLE DATA (NOT LIVE)') !== -1,
    quotedComma: csv.indexOf('"Dubai, UAE"') !== -1,
    formulaNeutralised: escapeCsvCell('=cmd') === "'=cmd",
    negativeStaysNumeric: escapeCsvCell(-12.5) === '-12.5',
    csv,
  })
}
