import type { BestBuyProduct } from '#/server/bestbuy/types'

/**
 * Spec sheet model (IMA-29): merges the curated DTO fields with the full
 * manufacturer `details` dump into one deduped row list the UI (and the
 * fuzzy spec search) consumes.
 *
 * DOC-13 doctrine: Sidekick's failure is "an undifferentiated dump of a
 * thousand spec rows". Ours is the same data, but curated rows lead,
 * duplicates are collapsed, and every row is searchable.
 */

export interface SpecRow {
  label: string
  value: string
  /** True for the dozen fields we curate from the DTO (always listed first). */
  curated: boolean
}

/** Lowercase, strip punctuation/whitespace runs — the dedupe identity. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Manufacturer detail names that restate curated rows. Only obvious
 * restatements — when in doubt, keep the row (extra truth beats missing
 * truth on the floor).
 */
const CURATED_EQUIVALENTS = new Set([
  'brand',
  'brand name',
  'manufacturer',
  'model',
  'model number',
  'color',
  'color category',
  'product width',
  'product height',
  'product depth',
  'product weight',
  'product length',
  'width',
  'height',
  'depth',
  'weight',
  'upc',
  'labor warranty',
  'parts warranty',
  'warranty labor',
  'warranty parts',
])

export function buildSpecRows(product: BestBuyProduct): SpecRow[] {
  const curatedPairs: [string, string | null][] = [
    ['Brand', product.manufacturer],
    ['Model', product.modelNumber],
    ['Color', product.color],
    ['Width', product.width],
    ['Height', product.height],
    ['Depth', product.depth],
    ['Weight', product.weight],
    ['Warranty (parts)', product.warrantyParts],
    ['Warranty (labor)', product.warrantyLabor],
    ['Condition', product.condition],
    ['Released', product.releaseDate],
    ['UPC', product.upc],
  ]

  const rows: SpecRow[] = []
  const seen = new Set<string>()

  for (const [label, value] of curatedPairs) {
    if (value === null) continue
    rows.push({ label, value, curated: true })
    seen.add(`${normalize(label)}\u0000${normalize(value)}`)
  }

  for (const detail of product.details) {
    const name = normalize(detail.name)
    const identity = `${name}\u0000${normalize(detail.value)}`
    // Skip restatements of curated rows and exact repeats within details.
    if (CURATED_EQUIVALENTS.has(name)) continue
    if (seen.has(identity)) continue
    // v1 lesson: some rows just repeat the product title — noise.
    if (normalize(detail.value) === normalize(product.name)) continue
    seen.add(identity)
    rows.push({ label: detail.name, value: detail.value, curated: false })
  }

  return rows
}

/* ── Measurements & metric conversion (IMA-29 unit toggle) ─────────────── */

export interface Measurement {
  value: number
  unit: 'inches' | 'pounds' | 'ounces' | 'feet'
}

const UNIT_PATTERNS: [RegExp, Measurement['unit']][] = [
  [/^(inches|inch|in\.?|")$/i, 'inches'],
  [/^(pounds|pound|lbs\.?|lb\.?)$/i, 'pounds'],
  [/^(ounces|ounce|oz\.?)$/i, 'ounces'],
  [/^(feet|foot|ft\.?|')$/i, 'feet'],
]

/**
 * Parse Best Buy's unit-suffixed measurement strings ("28.9 inches",
 * "6.3 lbs.") — returns null for anything unrecognized, in which case the
 * UI falls back to the raw string.
 */
export function parseMeasurement(raw: string): Measurement | null {
  const match = raw.trim().match(/^(\d+(?:\.\d+)?)\s*([a-z."']+)$/i)
  if (!match) return null
  const value = Number(match[1])
  if (!Number.isFinite(value)) return null
  for (const [pattern, unit] of UNIT_PATTERNS) {
    if (pattern.test(match[2])) return { value, unit }
  }
  return null
}

/** Metric rendering: cm for lengths, kg (g under 1 kg) for weights. */
export function toMetric(measurement: Measurement): string {
  switch (measurement.unit) {
    case 'inches':
      return `${trim(measurement.value * 2.54)} cm`
    case 'feet':
      return `${trim(measurement.value * 30.48)} cm`
    case 'pounds': {
      const kg = measurement.value * 0.453592
      return kg < 1 ? `${Math.round(kg * 1000)} g` : `${trim(kg)} kg`
    }
    case 'ounces': {
      const grams = measurement.value * 28.3495
      return grams < 1000
        ? `${Math.round(grams)} g`
        : `${trim(grams / 1000)} kg`
    }
  }
}

/** Imperial rendering: short unit labels, not BB's verbose "inches". */
export function toImperialShort(measurement: Measurement): string {
  switch (measurement.unit) {
    case 'inches':
      return `${trim(measurement.value)}″`
    case 'feet':
      return `${trim(measurement.value)} ft`
    case 'pounds':
      return `${trim(measurement.value)} lb`
    case 'ounces':
      return `${trim(measurement.value)} oz`
  }
}

function trim(value: number): string {
  return (Math.round(value * 10) / 10).toString()
}

/** W × H × D assembled line for the given unit system, or null if any part
 *  is missing/unparseable (never show a half-true dimension line). */
export function dimensionLine(
  product: BestBuyProduct,
  metric: boolean,
): string | null {
  const parts = [product.width, product.height, product.depth]
  if (parts.some((part) => part === null)) return null
  const parsed = parts.map((part) => parseMeasurement(part as string))
  if (parsed.some((m) => m === null)) return null
  const render = metric ? toMetric : toImperialShort
  const [w, h, d] = parsed.map((m) => render(m as Measurement))
  return `${w} W × ${h} H × ${d} D`
}
