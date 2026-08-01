'use client'

export interface FunnelChartStep {
  name: string
  value: number
  /** Bar width as a share of the widest stage (0-100) — drives the silhouette. */
  percentage: number
  /** Percentage lost vs. the immediately preceding stage (0-100). 0 for the first stage. */
  dropOff: number
  /**
   * Optional sub-label shown under/next to the value instead of the default
   * "X% of total" (e.g. a source note or "Not connected"). Lets the chart show
   * cross-source stages honestly without implying same-cohort conversion.
   */
  note?: string
}

export interface FunnelChartProps {
  steps: FunnelChartStep[]
  title?: string
  /**
   * Show the red "-X% drop-off" marker between stages. Default true (true
   * same-cohort funnels). Set false for cross-source/cross-population journeys
   * where a between-stage "drop-off" would be misleading.
   */
  showDropOff?: boolean
}

// Bar width shrinks toward the center as the value share falls, giving the
// classic "funnel" silhouette. Clamped to a sensible minimum so low-volume or
// not-yet-connected stages stay visible/readable.
const MIN_WIDTH_PCT = 18

// Gradient endpoints the bar fill interpolates across as steps progress:
// mrhb-blue (#01A6FA) at the top to mrhb-warm-tan (#E5B897) at the bottom.
const GRADIENT_START = { r: 0x01, g: 0xa6, b: 0xfa }
const GRADIENT_END = { r: 0xe5, g: 0xb8, b: 0x97 }

function lerpChannel(start: number, end: number, t: number): number {
  return Math.round(start + (end - start) * t)
}

/** Interpolated fill color for a step at `index` of `total`, walking from mrhb-blue to mrhb-warm-tan. */
function stepColor(index: number, total: number): string {
  if (total <= 1) {
    return `rgb(${GRADIENT_START.r}, ${GRADIENT_START.g}, ${GRADIENT_START.b})`
  }

  const t = index / (total - 1)
  const r = lerpChannel(GRADIENT_START.r, GRADIENT_END.r, t)
  const g = lerpChannel(GRADIENT_START.g, GRADIENT_END.g, t)
  const b = lerpChannel(GRADIENT_START.b, GRADIENT_END.b, t)
  return `rgb(${r}, ${g}, ${b})`
}

export default function FunnelChart({ steps, title, showDropOff = true }: FunnelChartProps) {
  return (
    <div className="rounded-xl bg-mrhb-white p-5 shadow-sm">
      {title && (
        <h3 className="mb-4 text-base font-semibold text-mrhb-dark">{title}</h3>
      )}

      {steps.length === 0 ? (
        <p className="py-8 text-center text-sm text-mrhb-dark/50">
          No funnel data available.
        </p>
      ) : (
        <div className="flex flex-col items-stretch gap-2">
          {steps.map((step, index) => {
            const widthPct = Math.max(MIN_WIDTH_PCT, step.percentage)
            const isFirst = index === 0

            return (
              <div key={step.name}>
                {showDropOff && !isFirst && (
                  <div className="flex items-center justify-center gap-1.5 py-1 text-xs font-medium text-red-500">
                    <span aria-hidden className="text-red-400">&#9660;</span>
                    <span>-{step.dropOff.toFixed(1)}% drop-off</span>
                  </div>
                )}

                <div className="flex items-center gap-4">
                  <div className="flex w-full items-center justify-center">
                    <div
                      className="flex min-h-[56px] w-full items-center justify-between gap-4 rounded-lg px-5 py-3 text-mrhb-white shadow-sm transition-all duration-300"
                      style={{
                        maxWidth: `${widthPct}%`,
                        backgroundColor: stepColor(index, steps.length),
                      }}
                    >
                      <span className="text-sm font-semibold leading-tight">
                        {index + 1}. {step.name}
                      </span>
                      <div className="flex-shrink-0 text-right">
                        <p className="text-base font-bold leading-tight">
                          {step.value.toLocaleString()}
                        </p>
                        <p className="text-[11px] font-medium text-mrhb-white/80">
                          {step.note ?? `${step.percentage.toFixed(1)}% of total`}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
