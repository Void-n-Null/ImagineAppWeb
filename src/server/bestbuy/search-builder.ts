import { BestBuyError } from './errors'
import { normalizeSearchTerms } from './search-terms'

/**
 * Fluent builder for Best Buy `/products(<filter>)` queries — the TS port of
 * v1's ProductSearchBuilder (lib/services/bestbuy/search_builder.dart),
 * redesigned against live-measured API behavior (IMA-DOC-4, 2026-07-06).
 *
 * Deliberate departures from v1, all evidence-based:
 *
 * - **Every string value is quoted** (v1 only quoted manufacturer/color).
 *   Measured: unquoted `modelNumber=Z1H81LL/A` is a 400 — the `/` kills the
 *   grammar parser mid-expression.
 * - **`bestSellingRank` is gone.** It is null on every product in 2026 data
 *   and sorting by it silently degrades to SKU order. The working popularity
 *   proxy is `customerReviewCount.dsc` — but only combined with noise
 *   exclusion (a Geek Squad plan carries 30,812 reviews).
 * - **v1's dead filters are dropped**: `marketplace` and `digital` match 0
 *   products in 2026, and `active=true` is already the server-side default.
 * - **`search=` terms go through normalizeSearchTerms** (fused-token
 *   expansion, unit collapsing, stopword removal) because `search=` matches
 *   product names ONLY, ANDed.
 * - **Facets are supported** (`facet=manufacturer,8` etc.) — one call
 *   answers "which brands do we carry in X"; v1 never used them.
 *
 * The output feeds `BestBuyClient.products(filter, params)`. The builder is
 * the only sanctioned producer of filter expressions from dynamic input —
 * every value is validated or quoted here so callers (server functions, the
 * IMA-6 agent tools) can pass user/model text through safely.
 */

/**
 * Sort orders that verifiably work (IMA-DOC-4). `bestSellingRank` is
 * intentionally absent — see module doc.
 */
export type ProductSort =
  | 'customerReviewCount.dsc'
  | 'customerReviewAverage.dsc'
  | 'salePrice.asc'
  | 'salePrice.dsc'
  | 'releaseDate.dsc'
  | 'releaseDate.asc'
  | 'name.asc'
  | 'name.dsc'
  | 'sku.asc'

/**
 * The universal default: popularity proxy via review volume. Also the
 * contract that makes alphabetized search-term caching safe — an explicit
 * sort must ALWAYS be set or result order would depend on term order.
 */
export const DEFAULT_SORT: ProductSort = 'customerReviewCount.dsc'

const MAX_PAGE_SIZE = 100
const CATEGORY_ID = /^[a-zA-Z0-9]+$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Quote a string value for the filter grammar. The grammar has no escape
 * syntax, so embedded double quotes are stripped rather than guessed at.
 */
function quote(value: string): string {
  return `"${value.replace(/"/g, '').trim()}"`
}

function requireFinite(value: number, what: string): number {
  if (!Number.isFinite(value)) {
    throw new BestBuyError(`Invalid ${what}: ${value}`)
  }
  return value
}

function requirePositiveInt(value: number, what: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new BestBuyError(`Invalid ${what}: ${value}`)
  }
  return value
}

function requireCategoryId(id: string): string {
  if (!CATEGORY_ID.test(id)) {
    throw new BestBuyError(`Invalid category id: ${id}`)
  }
  return id
}

function requireIsoDate(date: string, what: string): string {
  if (!ISO_DATE.test(date)) {
    throw new BestBuyError(`Invalid ${what} (want YYYY-MM-DD): ${date}`)
  }
  return date
}

export interface BuiltProductsQuery {
  /** Parenthesized filter expression body for `/products(<filter>)`. */
  filter: string
  /** Query params (page/pageSize/sort/facet) for the same request. */
  params: Record<string, string>
}

export class ProductSearchBuilder {
  #searchTerms: string[] = []
  #filters: string[] = []
  #sort: ProductSort = DEFAULT_SORT
  #page = 1
  #pageSize = 10
  #facet: string | null = null

  // ───────────────────────────── Search terms ─────────────────────────────

  /**
   * Add normalized keyword terms from free text (user or model generated).
   * Safe against grammar injection: normalization restricts the charset.
   */
  keywords(query: string): this {
    this.#searchTerms.push(...normalizeSearchTerms(query))
    this.#searchTerms = [...new Set(this.#searchTerms)].sort().slice(0, 10)
    return this
  }

  /** Number of accumulated search terms (callers bail on zero). */
  get searchTermCount(): number {
    return this.#searchTerms.length
  }

  // ─────────────────────────── Identity filters ───────────────────────────

  bySku(sku: number): this {
    this.#filters.push(`sku=${requirePositiveInt(sku, 'SKU')}`)
    return this
  }

  bySkus(skus: number[]): this {
    if (skus.length === 0) return this
    const list = skus.map((s) => requirePositiveInt(s, 'SKU')).join(',')
    this.#filters.push(`sku in(${list})`)
    return this
  }

  byUpc(upc: string): this {
    if (!/^\d{6,14}$/.test(upc)) throw new BestBuyError(`Invalid UPC: ${upc}`)
    this.#filters.push(`upc=${upc}`)
    return this
  }

  /** Model numbers routinely contain `/` — always quoted (measured 400). */
  byModelNumber(modelNumber: string): this {
    this.#filters.push(`modelNumber=${quote(modelNumber)}`)
    return this
  }

  // ─────────────────────────── Scoping filters ────────────────────────────

  inCategory(categoryId: string): this {
    this.#filters.push(`categoryPath.id=${requireCategoryId(categoryId)}`)
    return this
  }

  inCategories(categoryIds: string[]): this {
    if (categoryIds.length === 0) return this
    const list = categoryIds.map(requireCategoryId).join(',')
    this.#filters.push(`categoryPath.id in(${list})`)
    return this
  }

  notInCategory(categoryId: string): this {
    this.#filters.push(`categoryPath.id!=${requireCategoryId(categoryId)}`)
    return this
  }

  byManufacturer(manufacturer: string): this {
    this.#filters.push(`manufacturer=${quote(manufacturer)}`)
    return this
  }

  byManufacturers(manufacturers: string[]): this {
    if (manufacturers.length === 0) return this
    this.#filters.push(`manufacturer in(${manufacturers.map(quote).join(',')})`)
    return this
  }

  color(color: string): this {
    this.#filters.push(`color=${quote(color)}`)
    return this
  }

  // ──────────────────────── Price / rating filters ────────────────────────

  priceRange(range: { min?: number; max?: number }): this {
    if (range.min !== undefined) {
      this.#filters.push(`salePrice>=${requireFinite(range.min, 'min price')}`)
    }
    if (range.max !== undefined) {
      this.#filters.push(`salePrice<=${requireFinite(range.max, 'max price')}`)
    }
    return this
  }

  onSaleOnly(): this {
    this.#filters.push('onSale=true')
    return this
  }

  minRating(rating: number): this {
    this.#filters.push(
      `customerReviewAverage>=${requireFinite(rating, 'rating')}`,
    )
    return this
  }

  minReviewCount(count: number): this {
    this.#filters.push(
      `customerReviewCount>=${requirePositiveInt(count, 'review count')}`,
    )
    return this
  }

  // ─────────────────────── Availability / condition ───────────────────────

  /**
   * Floor gold (measured): restricts to products stores actually stock,
   * cutting refurb sediment and online-only noise in one filter.
   *
   * CHAIN-WIDE semantics: "stocked in Best Buy stores", not "at YOUR
   * store". No location is involved. Per-store truth needs atStore() or
   * the Stores API (client.storeAvailability). UI copy must say
   * "sold in stores", never "in store" (IMA-24).
   */
  availableInStore(): this {
    this.#filters.push('inStoreAvailability=true')
    return this
  }

  availableOnline(): this {
    this.#filters.push('onlineAvailability=true')
    return this
  }

  atStore(storeId: number): this {
    this.#filters.push(
      `storeAvailability.storeId=${requirePositiveInt(storeId, 'store id')}`,
    )
    return this
  }

  /**
   * `condition=new` clears a decade of Certified-Refurbished sediment that
   * otherwise dominates un-filtered category listings (measured).
   */
  newOnly(): this {
    this.#filters.push('condition=new')
    return this
  }

  refurbishedOnly(): this {
    this.#filters.push('condition=refurbished')
    return this
  }

  preOwnedOnly(): this {
    this.#filters.push('condition=pre-owned')
    return this
  }

  freeShippingOnly(): this {
    this.#filters.push('freeShipping=true')
    return this
  }

  releasedAfter(date: string): this {
    this.#filters.push(`releaseDate>=${requireIsoDate(date, 'release date')}`)
    return this
  }

  releasedBefore(date: string): this {
    this.#filters.push(`releaseDate<=${requireIsoDate(date, 'release date')}`)
    return this
  }

  // ───────────────────────── Vertical attributes ──────────────────────────

  /**
   * TVs carry a numeric `screenSizeIn` (a "65-inch class" panel is 64.5).
   * A ±2" range beats keyword size tokens outright: measured 104 clean
   * results vs 8 junk ones for "65 inch tv". Pattern extends to other
   * verticals as they're probed.
   */
  screenSizeBetween(minInches: number, maxInches: number): this {
    this.#filters.push(
      `screenSizeIn>=${requireFinite(minInches, 'screen size')}`,
      `screenSizeIn<=${requireFinite(maxInches, 'screen size')}`,
    )
    return this
  }

  // ────────────────────────── Noise exclusions ────────────────────────────

  /**
   * The floor default: strip catalog classes no customer conversation needs.
   *
   * - `type!=BlackTie` — Best Buy's undocumented internal type for EVERY
   *   warranty/AppleCare/GSP plan and most memberships. A naive `macbook`
   *   search returns 10/10 BlackTie rows (measured); this is the single
   *   highest-value filter in the app.
   * - Gift Cards (`cat09000`) and Services (`pcmcat1528819595254`) category
   *   trees — the residue BlackTie misses.
   *
   * v1 also excluded by manufacturer ("AppleCare", "Geek Squad®") and via
   * `digital=false` / `marketplace` — all redundant or dead in 2026 data.
   */
  excludeFloorNoise(): this {
    this.#filters.push(
      'type!=BlackTie',
      'categoryPath.id!=cat09000',
      'categoryPath.id!=pcmcat1528819595254',
    )
    return this
  }

  // ─────────────────────── Escape hatch (server-only) ─────────────────────

  /**
   * Raw filter fragment for expressions the builder doesn't model yet.
   * NEVER pass user/model text here — this bypasses quoting/validation.
   */
  rawFilter(expression: string): this {
    this.#filters.push(expression)
    return this
  }

  // ─────────────────────────── Response shaping ───────────────────────────

  sortBy(sort: ProductSort): this {
    this.#sort = sort
    return this
  }

  page(page: number): this {
    this.#page = Math.min(Math.max(Math.trunc(page), 1), 1000)
    return this
  }

  pageSize(size: number): this {
    this.#pageSize = Math.min(Math.max(Math.trunc(size), 1), MAX_PAGE_SIZE)
    return this
  }

  /**
   * Request a facet rollup alongside results, e.g. `facet('manufacturer', 8)`
   * → `{samsung: 198, lg: 123, …}`. Verified working live (IMA-DOC-4).
   */
  facet(attribute: string, count: number): this {
    if (!/^[a-zA-Z.]+$/.test(attribute)) {
      throw new BestBuyError(`Invalid facet attribute: ${attribute}`)
    }
    this.#facet = `${attribute},${requirePositiveInt(count, 'facet count')}`
    return this
  }

  // ────────────────────────────────  Build ────────────────────────────────

  /** True when the query has no filter fragments at all. */
  get isEmpty(): boolean {
    return this.#searchTerms.length === 0 && this.#filters.length === 0
  }

  build(): BuiltProductsQuery {
    if (this.isEmpty) {
      throw new BestBuyError('Refusing to build an unfiltered products query')
    }
    const fragments = [
      ...this.#searchTerms.map((term) => `search=${term}`),
      ...this.#filters,
    ]
    const params: Record<string, string> = {
      page: String(this.#page),
      pageSize: String(this.#pageSize),
      sort: this.#sort,
    }
    if (this.#facet !== null) params.facet = this.#facet
    return { filter: fragments.join('&'), params }
  }
}
