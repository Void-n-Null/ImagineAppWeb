import { useMemo } from 'react'
import { type EncodedBarcode, encodeRetailBarcode } from './encode'

/**
 * Scannable retail barcode (IMA-11) — SVG tuned for register scanners
 * reading a PHONE SCREEN, per GS1 spec constraints:
 *
 * - quiet zones ≥ 10 modules of true white each side (quiet-zone violations
 *   are the #1 cause of POS scan failures)
 * - dark bars on a pure-white card; the surrounding UI stays dark so the
 *   symbol is the brightest thing on screen
 * - `shape-rendering: crispEdges` + whole-module SVG grid: no anti-aliased
 *   gray edges between bars
 * - guard patterns (and UPC-A's first/last digit, per spec) extend below
 *   the data bars; human-readable digits sit in the cutouts
 *
 * At full phone width (~340 CSS px for 115 modules) the X-dimension lands
 * around 0.5 mm — comfortably inside GS1's 0.26–0.66 mm POS window.
 */

// Classic UPC proportions (GS1 nominal is ~1.44:1 including digits) —
// squatter than a naive tall render, which is also what makes it read as
// "a real shelf-tag barcode" to the eye.
const QUIET = 10 // modules each side
const MODULES = 95
const TOTAL_W = QUIET + MODULES + QUIET
const BAR_H = 52 // data-bar height, SVG units (1 unit = 1 module width)
const GUARD_DROP = 6 // extra height on guard bars
const TEXT_H = 12 // digit lane below the data bars
const TOTAL_H = BAR_H + GUARD_DROP + TEXT_H - 4

/** Module index ranges (inclusive) that render full-height. */
function tallRanges(format: EncodedBarcode['format']): [number, number][] {
  const guards: [number, number][] = [
    [0, 2],
    [45, 49],
    [92, 94],
  ]
  // UPC-A: bars of the first and last data digit join the guards (GS1 layout).
  return format === 'upc-a'
    ? [
        [0, 9],
        [45, 49],
        [85, 94],
      ]
    : guards
}

function isTall(index: number, ranges: [number, number][]): boolean {
  return ranges.some(([start, end]) => index >= start && index <= end)
}

/** Merge consecutive dark modules of equal height into single rects. */
function buildRects(encoded: EncodedBarcode) {
  const ranges = tallRanges(encoded.format)
  const rects: { x: number; w: number; tall: boolean }[] = []
  let run: { x: number; w: number; tall: boolean } | null = null
  encoded.modules.forEach((dark, i) => {
    const tall = isTall(i, ranges)
    if (
      dark &&
      run !== null &&
      run.tall === tall &&
      run.x + run.w === i + QUIET
    ) {
      run.w += 1
      return
    }
    if (dark) {
      run = { x: i + QUIET, w: 1, tall }
      rects.push(run)
    } else {
      run = null
    }
  })
  return rects
}

/** Digit groups with their center positions (in modules, incl. quiet). */
function digitGroups(encoded: EncodedBarcode) {
  const d = encoded.digits
  if (encoded.format === 'upc-a') {
    return [
      { text: d[0], center: QUIET / 2, small: true },
      { text: d.slice(1, 6), center: QUIET + 27.5, small: false },
      { text: d.slice(6, 11), center: QUIET + 67.5, small: false },
      { text: d[11], center: QUIET + MODULES + QUIET / 2, small: true },
    ]
  }
  return [
    { text: d[0], center: QUIET / 2, small: false },
    { text: d.slice(1, 7), center: QUIET + 24, small: false },
    { text: d.slice(7, 13), center: QUIET + 71, small: false },
  ]
}

export function RetailBarcode({
  upc,
  className,
}: {
  upc: string
  className?: string
}) {
  const encoded = useMemo(() => encodeRetailBarcode(upc), [upc])
  if (encoded === null) return null

  const rects = buildRects(encoded)

  return (
    <svg
      viewBox={`0 0 ${TOTAL_W} ${TOTAL_H}`}
      className={className}
      role="img"
      aria-label={`Barcode ${encoded.digits}`}
      shapeRendering="crispEdges"
      preserveAspectRatio="xMidYMid meet"
    >
      {/* True-white floor including the quiet zones. */}
      <rect x={0} y={0} width={TOTAL_W} height={TOTAL_H} fill="#ffffff" />
      {rects.map((rect) => (
        <rect
          key={rect.x}
          x={rect.x}
          y={0}
          width={rect.w}
          height={rect.tall ? BAR_H + GUARD_DROP : BAR_H}
          fill="#000000"
        />
      ))}
      {digitGroups(encoded).map((group) => (
        <text
          key={`${group.text}-${group.center}`}
          x={group.center}
          y={TOTAL_H - 2}
          textAnchor="middle"
          fontSize={group.small ? 6 : 8.5}
          fontWeight={600}
          letterSpacing={group.small ? 0 : 1.4}
          fontFamily="ui-monospace, monospace"
          fill="#000000"
        >
          {group.text}
        </text>
      ))}
    </svg>
  )
}
