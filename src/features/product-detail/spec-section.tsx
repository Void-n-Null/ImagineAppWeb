import { Ruler, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { cn } from '#/lib/utils'
import type { BestBuyProduct } from '#/server/bestbuy/types'
import {
  buildSpecRows,
  dimensionLine,
  parseMeasurement,
  type SpecRow,
  toMetric,
} from './spec-model'
import { type SpecMatch, searchSpecs } from './spec-search'

/**
 * Specs section (IMA-29) — the full manufacturer sheet with the fuzzy,
 * alias-aware search. Three rules from DOC-13:
 * - curated rows lead, the dump never leads
 * - past a dozen rows, search is mandatory (Sidekick's failure is
 *   "scroll forever hunting while the customer watches")
 * - progressive disclosure: collapsed by default, expanded by intent
 *   (searching or "Show all")
 */

/** Rows shown before "Show all N specs" when the sheet is long. */
const COLLAPSED_COUNT = 12
/** Search only earns its pixels when scrolling would actually hurt. */
const SEARCH_THRESHOLD = 9

const UNITS_STORAGE = 'imagine:metric-units'

function storedMetric(): boolean {
  if (typeof localStorage === 'undefined') return false
  return localStorage.getItem(UNITS_STORAGE) === '1'
}

export function SpecSection({ product }: { product: BestBuyProduct }) {
  const rows = useMemo(() => buildSpecRows(product), [product])
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [metric, setMetricState] = useState(storedMetric)

  if (rows.length === 0) return null

  const setMetric = (on: boolean) => {
    setMetricState(on)
    try {
      localStorage.setItem(UNITS_STORAGE, on ? '1' : '0')
    } catch {
      // Private mode — the toggle still works for this page view.
    }
  }

  const dimensions = dimensionLine(product, metric)
  // The assembled dimensions row supersedes the individual W/H/D rows —
  // but only outside search, where "height" must still hit a row.
  const searching = query.trim().length > 0
  const baseRows =
    dimensions !== null && !searching
      ? rows.filter((row) => !['Width', 'Height', 'Depth'].includes(row.label))
      : rows

  const matches = searchSpecs(baseRows, query)
  const visible =
    searching || expanded || matches.length <= COLLAPSED_COUNT
      ? matches
      : matches.slice(0, COLLAPSED_COUNT)
  const hiddenCount = matches.length - visible.length

  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between">
        <h2 className="aisle-label">
          Specs
          <span className="ml-1.5 font-semibold normal-case tracking-normal text-text-faint">
            {rows.length}
          </span>
        </h2>
        {dimensions !== null && (
          <UnitToggle metric={metric} onChange={setMetric} />
        )}
      </div>

      {rows.length >= SEARCH_THRESHOLD && (
        <SpecSearchInput query={query} onChange={setQuery} />
      )}

      {dimensions !== null && !searching && (
        <div className="card-glint flex items-center gap-2.5 rounded-xl bg-surface px-3.5 py-2.5">
          <Ruler
            size={15}
            aria-hidden="true"
            className="shrink-0 text-action"
          />
          <p className="tabular text-body-sm font-semibold">{dimensions}</p>
        </div>
      )}

      {matches.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-3.5 py-3 text-body-sm text-text-muted">
          No spec matches “{query.trim()}”. Try another word — or ask the
          assistant, it can search the web for specs this sheet omits.
        </p>
      ) : (
        <dl className="card-glint overflow-hidden rounded-xl bg-surface">
          {visible.map((match, i) => (
            <SpecRowItem
              key={`${match.row.label}\u0000${match.row.value}`}
              match={match}
              first={i === 0}
              metric={metric}
            />
          ))}
        </dl>
      )}

      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="self-start text-body-sm font-bold text-action"
        >
          Show all {matches.length} specs
        </button>
      )}
      {expanded && !searching && matches.length > COLLAPSED_COUNT && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="self-start text-body-sm font-bold text-action"
        >
          Show fewer
        </button>
      )}
    </section>
  )
}

function SpecSearchInput({
  query,
  onChange,
}: {
  query: string
  onChange: (value: string) => void
}) {
  return (
    <div className="card-glint relative flex items-center rounded-xl bg-raised">
      <Search
        size={15}
        aria-hidden="true"
        className="pointer-events-none absolute left-3.5 text-text-faint"
      />
      <input
        type="search"
        value={query}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search specs — “size”, “hdmi”, “alexa”…"
        aria-label="Search specifications"
        enterKeyHint="search"
        className="min-h-11 w-full bg-transparent pr-10 pl-9 text-body-lg text-text placeholder:text-text-faint [&::-webkit-search-cancel-button]:hidden"
      />
      {query.length > 0 && (
        <button
          type="button"
          aria-label="Clear spec search"
          onClick={() => onChange('')}
          className="absolute right-1 grid h-9 w-9 place-items-center rounded-full text-text-muted"
        >
          <X size={15} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

function UnitToggle({
  metric,
  onChange,
}: {
  metric: boolean
  onChange: (on: boolean) => void
}) {
  return (
    <fieldset
      aria-label="Measurement units"
      className="flex rounded-full bg-raised p-0.5"
    >
      {([false, true] as const).map((isMetric) => (
        <button
          key={isMetric ? 'cm' : 'in'}
          type="button"
          aria-pressed={metric === isMetric}
          onClick={() => onChange(isMetric)}
          className={cn(
            'min-h-7 rounded-full px-2.5 text-micro font-bold transition-colors duration-150',
            metric === isMetric
              ? 'bg-action text-action-ink'
              : 'text-text-faint',
          )}
        >
          {isMetric ? 'cm' : 'in'}
        </button>
      ))}
    </fieldset>
  )
}

/** Curated physical rows convert with the unit toggle; detail-dump rows
 *  stay verbatim (manufacturer numbers, untouched). */
const CONVERTIBLE_LABELS = new Set(['Width', 'Height', 'Depth', 'Weight'])

function SpecRowItem({
  match,
  first,
  metric,
}: {
  match: SpecMatch
  first: boolean
  metric: boolean
}) {
  const { row } = match
  let value = row.value
  let valueRanges = match.valueRanges
  if (metric && row.curated && CONVERTIBLE_LABELS.has(row.label)) {
    const parsed = parseMeasurement(row.value)
    if (parsed !== null) {
      value = toMetric(parsed)
      valueRanges = [] // converted text no longer aligns with match ranges
    }
  }

  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-4 px-3.5 py-2.5',
        !first && 'border-t border-line',
      )}
    >
      <dt className="shrink-0 text-body-sm text-text-faint">
        <Highlighted text={row.label} ranges={match.labelRanges} />
      </dt>
      <dd className="text-right text-body-sm font-semibold">
        <Highlighted text={value} ranges={valueRanges} />
      </dd>
    </div>
  )
}

/** Render text with <mark> highlights over merged match ranges. */
function Highlighted({
  text,
  ranges,
}: {
  text: string
  ranges: [number, number][]
}) {
  if (ranges.length === 0) return <>{text}</>
  const parts: React.ReactNode[] = []
  let cursor = 0
  for (const [start, end] of ranges) {
    if (start > cursor) parts.push(text.slice(cursor, start))
    parts.push(
      <mark
        key={start}
        className="rounded-[0.2rem] bg-action-subtle px-0.5 text-action"
      >
        {text.slice(start, end)}
      </mark>,
    )
    cursor = end
  }
  if (cursor < text.length) parts.push(text.slice(cursor))
  return <>{parts}</>
}

// Re-exported for the page's jump rail to know whether the section renders.
export function hasSpecs(product: BestBuyProduct): boolean {
  return buildSpecRows(product).length > 0
}

export type { SpecRow }
