/**
 * CSV export helpers for the MRHB Analytics dashboard.
 *
 * Design notes (read before changing):
 *
 * 1. EXPORTS MUST MATCH THE SCREEN. A page builds its export payload from the
 *    SAME `data` object it renders, so a manager can never get a CSV whose
 *    numbers disagree with the dashboard. Do not re-query Supabase to build an
 *    export — that would create a second, divergent source of truth.
 * 2. SAMPLE DATA STAYS LABELLED. Sections sourced from sample/mock fallbacks
 *    (Clarity UX, unconfigured revenue, GA4 gaps) must set `sample: true`, and
 *    the writer stamps a loud warning into the file itself. A CSV outlives the
 *    page it came from — the label has to travel with the numbers.
 * 3. RAW NUMBERS, NOT DISPLAY STRINGS. Cells carry unformatted numbers so
 *    spreadsheets can sum/chart them; units live in the column label
 *    ("Bounce Rate (%)", "Avg Session (seconds)"). The value is identical to
 *    what the page shows — only the presentation differs.
 *
 * This module is intentionally dependency-free and framework-agnostic so it can
 * be imported by both server components and the client download button.
 */

export interface CsvColumn {
  /** Key to read from each row object. */
  key: string
  /** Human-readable header, including units where relevant. */
  label: string
}

export interface CsvSection {
  /** Block heading written above the rows, e.g. "Top Sources / Medium". */
  title: string
  columns: CsvColumn[]
  rows: Array<Record<string, string | number | null | undefined>>
  /**
   * True when these rows come from a sample/mock fallback rather than a live
   * source. Stamps an explicit "SAMPLE DATA (NOT LIVE)" marker on the block.
   */
  sample?: boolean
  /** Provenance note, e.g. "Source: GA4 website property (de-duplicated)". */
  note?: string
}

export interface CsvExportPayload {
  /** Base filename WITHOUT extension or date, e.g. "mrhb-traffic". */
  filename: string
  /** Page name for the metadata preamble, e.g. "Traffic & Acquisition". */
  pageTitle: string
  /** Human label for the selected range, e.g. "Last 30 Days". */
  rangeLabel: string
  /** Inclusive window start (YYYY-MM-DD) from getDateWindow. */
  startDate: string
  /** Inclusive window end (YYYY-MM-DD) from getDateWindow. */
  endDate: string
  sections: CsvSection[]
  /** True when the WHOLE page is sample data (e.g. UX & Friction, Revenue). */
  sample?: boolean
}

/** Characters that make a spreadsheet treat a cell as a formula. */
const FORMULA_PREFIXES = ['=', '+', '@', '\t', '\r']

/**
 * Escape a single cell for CSV (RFC 4180) and neutralise formula injection.
 *
 * - Numbers are written bare so spreadsheets read them as numeric.
 * - Text containing a comma, quote, or newline is quoted, with inner quotes
 *   doubled.
 * - Text that would be parsed as a formula is prefixed with a single quote.
 *   A leading "-" only counts as a formula when the value isn't a real
 *   negative number, so "-12.5" stays numeric while "-cmd" gets neutralised.
 */
export function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''

  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : ''
  }

  let text = String(value)

  const startsFormula =
    FORMULA_PREFIXES.indexOf(text.charAt(0)) !== -1 ||
    (text.charAt(0) === '-' && Number.isNaN(Number(text)))

  if (startsFormula) text = "'" + text

  if (text.indexOf('"') !== -1 || text.indexOf(',') !== -1 || text.indexOf('\n') !== -1 || text.indexOf('\r') !== -1) {
    return '"' + text.replace(/"/g, '""') + '"'
  }

  return text
}

/** Join one row of already-selected values into a CSV line. */
function toCsvLine(values: Array<string | number | null | undefined>): string {
  return values.map(escapeCsvCell).join(',')
}

const SAMPLE_MARKER = 'SAMPLE DATA (NOT LIVE) — representative values, not sourced analytics'

/**
 * Render an export payload as a single CSV document: a metadata preamble
 * (page, range, generation time, data state) followed by one titled block per
 * section, separated by blank lines. Excel and Sheets both handle the multi
 * block layout, and it keeps a whole page in one file rather than one download
 * per table.
 *
 * `generatedAt` is passed in rather than read from the clock so the caller
 * controls the timestamp (and so this stays a pure function).
 */
export function buildCsv(payload: CsvExportPayload, generatedAt: string): string {
  const lines: string[] = []

  lines.push(toCsvLine(['MRHB Analytics Export']))
  lines.push(toCsvLine(['Page', payload.pageTitle]))
  lines.push(toCsvLine(['Date range', payload.rangeLabel]))
  lines.push(toCsvLine(['Window (inclusive)', payload.startDate + ' to ' + payload.endDate]))
  lines.push(toCsvLine(['Generated', generatedAt]))

  if (payload.sample) {
    lines.push(toCsvLine(['Data state', SAMPLE_MARKER]))
  }

  payload.sections.forEach(function (section) {
    lines.push('')
    lines.push(toCsvLine([section.title]))

    if (section.sample) {
      lines.push(toCsvLine([SAMPLE_MARKER]))
    }
    if (section.note) {
      lines.push(toCsvLine([section.note]))
    }

    lines.push(toCsvLine(section.columns.map(function (c) { return c.label })))

    if (section.rows.length === 0) {
      lines.push(toCsvLine(['No data available for this period.']))
      return
    }

    section.rows.forEach(function (row) {
      lines.push(toCsvLine(section.columns.map(function (c) { return row[c.key] })))
    })
  })

  // Trailing newline so the file ends cleanly for line-based tools.
  return lines.join('\r\n') + '\r\n'
}

/**
 * Build the download filename: "mrhb-traffic_30d_2026-08-13.csv".
 * Uses the window end date so a file is self-describing once saved.
 */
export function csvFilename(payload: CsvExportPayload, rangeKey: string): string {
  const safeRange = rangeKey.replace(/[^a-z0-9]/gi, '')
  return payload.filename + '_' + safeRange + '_' + payload.endDate + '.csv'
}
