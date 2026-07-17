import type { BestBuyProduct } from '#/server/bestbuy/types'

/**
 * Comparison engine (IMA-10) — the TS successor to v1's
 * comparison_engine.dart, deliberately smaller.
 *
 * v1 fuzzy-matched hundreds of messy `details` name/value pairs (synonym
 * tables, unit parsing) because that attribute was the only spec source. v2's
 * DTO carries a curated structured superset instead (price, rating, dims,
 * warranty, …) — so the engine is a fixed row schema over clean fields, plus
 * per-product feature lists. The agent's compare_products tool made the same
 * call (IMA-6); this is the human-facing equivalent.
 *
 * Pure data → data. No React, no fetching.
 */

export interface CompareRow {
  label: string
  /** One formatted value per product (aligned by index); null = not stated. */
  values: (string | null)[]
  /** At least two products state a value and they aren't all equal. */
  differs: boolean
  /** Index of the objectively-better value, only where that's well-defined. */
  bestIndex?: number
}

export interface ComparisonTable {
  products: BestBuyProduct[]
  rows: CompareRow[]
}

function formatMoney(value: number | null): string | null {
  if (value === null) return null
  return value % 1 === 0 ? `$${value.toFixed(0)}` : `$${value.toFixed(2)}`
}

function availabilityText(p: BestBuyProduct): string | null {
  const chain = p.inStoreAvailability === true
  const online = p.onlineAvailability === true
  if (chain && online) return 'Stores + online'
  if (chain) return 'Sold in stores'
  if (online) return 'Online only'
  if (p.inStoreAvailability === null && p.onlineAvailability === null)
    return null
  return 'Unavailable'
}

function leafCategory(p: BestBuyProduct): string | null {
  const leaf = p.categoryPath.at(-1)
  return leaf ? leaf.name : null
}

/**
 * Index of the best numeric value, or undefined when fewer than two values
 * exist, there's a tie for best, or `direction` is 'none'.
 */
function best(
  numbers: (number | null)[],
  direction: 'lowest' | 'highest',
): number | undefined {
  const present = numbers.filter((n): n is number => n !== null)
  if (present.length < 2) return undefined
  const target =
    direction === 'lowest' ? Math.min(...present) : Math.max(...present)
  const winners = numbers.filter((n) => n === target)
  if (winners.length !== 1) return undefined
  return numbers.indexOf(target)
}

function row(
  label: string,
  values: (string | null)[],
  bestIndex?: number,
): CompareRow | null {
  const present = values.filter((v): v is string => v !== null)
  if (present.length === 0) return null
  const differs =
    present.length >= 2 && new Set(present.map((v) => v.toLowerCase())).size > 1
  return { label, values, differs, bestIndex }
}

/** Build the aligned comparison table for 2-5 products. */
export function buildComparison(products: BestBuyProduct[]): ComparisonTable {
  const currentPrices = products.map((p) => p.salePrice ?? p.regularPrice)
  const ratings = products.map((p) => p.customerReviewAverage)

  const candidates: (CompareRow | null)[] = [
    row('Price', currentPrices.map(formatMoney), best(currentPrices, 'lowest')),
    row(
      'Regular price',
      products.map((p) =>
        p.onSale && p.regularPrice !== null
          ? formatMoney(p.regularPrice)
          : null,
      ),
    ),
    row(
      'Rating',
      products.map((p) =>
        p.customerReviewAverage !== null
          ? `${p.customerReviewAverage.toFixed(1)} ★ (${(p.customerReviewCount ?? 0).toLocaleString()})`
          : null,
      ),
      best(ratings, 'highest'),
    ),
    row(
      'Brand',
      products.map((p) => p.manufacturer),
    ),
    row(
      'Model',
      products.map((p) => p.modelNumber),
    ),
    row(
      'Color',
      products.map((p) => p.color),
    ),
    row('Availability', products.map(availabilityText)),
    row(
      'Free shipping',
      products.map((p) =>
        p.freeShipping === null ? null : p.freeShipping ? 'Yes' : 'No',
      ),
    ),
    row(
      'Released',
      products.map((p) => p.releaseDate),
    ),
    row(
      'Condition',
      products.map((p) => p.condition),
    ),
    row(
      'Width',
      products.map((p) => p.width),
    ),
    row(
      'Height',
      products.map((p) => p.height),
    ),
    row(
      'Depth',
      products.map((p) => p.depth),
    ),
    row(
      'Weight',
      products.map((p) => p.weight),
    ),
    row(
      'Warranty (parts)',
      products.map((p) => p.warrantyParts),
    ),
    row(
      'Warranty (labor)',
      products.map((p) => p.warrantyLabor),
    ),
    row('Category', products.map(leafCategory)),
    row(
      'UPC',
      products.map((p) => p.upc),
    ),
  ]

  return {
    products,
    rows: candidates.filter((r): r is CompareRow => r !== null),
  }
}
