import { BestBuyParseError } from './errors'

/**
 * Product DTO — a canonical superset modeled on v1's
 * ProductAttributePresets.full (lib/services/bestbuy/search_builder.dart).
 *
 * Every request asks for this same superset so that any product seen in any
 * response (single lookup, batch, or search) is interchangeable in the cache:
 * one entity entry can satisfy every future lookup for that day.
 *
 * Only `sku` and `name` are required; every other field is nullable and the
 * parser never throws on absence — Best Buy omits fields freely per product.
 */
export interface BestBuyProduct {
  // Core identifiers
  sku: number
  name: string
  upc: string | null
  type: string | null
  modelNumber: string | null
  manufacturer: string | null
  url: string | null
  addToCartUrl: string | null
  mobileUrl: string | null

  // Pricing
  salePrice: number | null
  regularPrice: number | null
  onSale: boolean
  percentSavings: number | null
  dollarSavings: number | null

  // Availability
  inStoreAvailability: boolean | null
  inStoreAvailabilityText: string | null
  onlineAvailability: boolean | null
  onlineAvailabilityText: string | null
  orderable: string | null
  freeShipping: boolean | null
  shippingCost: number | null
  releaseDate: string | null

  // Media
  image: string | null
  thumbnailImage: string | null
  mediumImage: string | null
  largeImage: string | null

  // Description & details
  longDescription: string | null
  shortDescription: string | null
  features: string[]
  includedItemList: string[]
  condition: string | null

  // Categories & classification
  categoryPath: CategoryRef[]

  // Reviews & ratings
  customerReviewAverage: number | null
  customerReviewCount: number | null

  // Physical specifications (IMA-10: unit-suffixed strings, e.g. "6 pounds")
  color: string | null
  weight: string | null
  height: string | null
  width: string | null
  depth: string | null

  // Warranty (IMA-10: free-text, e.g. "1 year" / "Limited lifetime")
  warrantyLabor: string | null
  warrantyParts: string | null

  /**
   * Manufacturer spec sheet (IMA-29): the full `details` name/value dump —
   * often dozens to hundreds of rows ("Screen Size", "Number of HDMI
   * Inputs 2.1", …). v1 parity (ProductAttribute.details). Order preserved
   * as Best Buy sends it; rows missing either half are dropped at parse.
   */
  details: ProductDetail[]

  /**
   * Set to true only on entity/product results served from a logically-expired
   * cache envelope because a refresh fetch failed transiently (stale-if-error).
   */
  stale?: true
}

/**
 * `show=` attribute list matching {@link BestBuyProduct}. This is the canonical
 * superset (v1's ProductAttributePresets.full); ALL product fetches request it
 * so every cache entry is interchangeable regardless of which call produced it.
 */
export const PRODUCT_ATTRIBUTES = [
  'sku',
  'upc',
  'name',
  'type',
  'modelNumber',
  'manufacturer',
  'url',
  'addToCartUrl',
  'mobileUrl',
  'salePrice',
  'regularPrice',
  'onSale',
  'percentSavings',
  'dollarSavings',
  'inStoreAvailability',
  'inStoreAvailabilityText',
  'onlineAvailability',
  'onlineAvailabilityText',
  'orderable',
  'freeShipping',
  'shippingCost',
  'releaseDate',
  'image',
  'thumbnailImage',
  'mediumImage',
  'largeImage',
  'longDescription',
  'shortDescription',
  'features.feature',
  'includedItemList.includedItem',
  'condition',
  'categoryPath.id',
  'categoryPath.name',
  'customerReviewAverage',
  'customerReviewCount',
  'color',
  'weight',
  'height',
  'width',
  'depth',
  'warrantyLabor',
  'warrantyParts',
  'details.name',
  'details.value',
] as const

/** One manufacturer spec row from the `details` attribute. */
export interface ProductDetail {
  name: string
  value: string
}

/**
 * Facet rollups keyed by attribute, e.g. `{ manufacturer: { samsung: 25 } }`.
 * Facet value names come back lowercased; the filter grammar is
 * case-insensitive on the way back in (measured 2026-07-06), so they can be
 * fed straight into `byManufacturer()`.
 */
export type ProductFacets = Record<string, Record<string, number>>

/** Envelope common to Best Buy collection responses. */
export interface ProductsPage {
  total: number
  currentPage: number
  totalPages: number
  products: BestBuyProduct[]
  /** Present when the request asked for a facet rollup (IMA-10 filters). */
  facets?: ProductFacets
  /** True when served stale from a logically-expired envelope (see grace). */
  stale?: true
}

function asRecord(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BestBuyParseError(`Expected JSON object for ${context}`)
  }
  return value as Record<string, unknown>
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  // Best Buy occasionally returns numeric fields (e.g. shippingCost) as strings.
  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * Best Buy ships product copy with raw HTML entities ("what&#8217;s",
 * "subwoofer.&#185;", "Insignia&trade;"). Decode at parse time so every
 * consumer — cards, detail pages, agent tool results — sees clean text.
 * Applied to prose fields only; URLs and identifiers stay verbatim.
 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  trade: '™',
  reg: '®',
  copy: '©',
  deg: '°',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
}

export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body) => {
    if (body.startsWith('#')) {
      const hex = body[1] === 'x' || body[1] === 'X'
      const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match
    }
    return NAMED_ENTITIES[body] ?? match
  })
}

function proseOrNull(value: unknown): string | null {
  const text = stringOrNull(value)
  return text === null ? null : decodeHtmlEntities(text)
}

function boolOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

/**
 * Best Buy nests list-of-scalar attributes under a single-key wrapper object,
 * e.g. `features: [{ feature: '...' }]`. Pull out `key`'s string values.
 */
function stringListFromWrapped(value: unknown, key: string): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    if (typeof item === 'string') {
      if (item.length > 0) out.push(decodeHtmlEntities(item))
      continue
    }
    if (typeof item === 'object' && item !== null) {
      const inner = (item as Record<string, unknown>)[key]
      if (typeof inner === 'string' && inner.length > 0) {
        out.push(decodeHtmlEntities(inner))
      }
    }
  }
  return out
}

/** Parse `details: [{ name, value }]` — drops rows missing either half. */
function parseDetails(value: unknown): ProductDetail[] {
  if (!Array.isArray(value)) return []
  const out: ProductDetail[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const obj = item as Record<string, unknown>
    const name = stringOrNull(obj.name)
    const detailValue = stringOrNull(obj.value)
    if (name !== null && detailValue !== null) {
      out.push({
        name: decodeHtmlEntities(name),
        value: decodeHtmlEntities(detailValue),
      })
    }
  }
  return out
}

export function parseProduct(raw: unknown): BestBuyProduct {
  const obj = asRecord(raw, 'product')
  const sku = numberOrNull(obj.sku)
  const name = stringOrNull(obj.name)
  if (sku === null || name === null) {
    throw new BestBuyParseError('Product missing required sku/name')
  }
  return {
    sku,
    name: decodeHtmlEntities(name),
    upc: stringOrNull(obj.upc),
    type: stringOrNull(obj.type),
    modelNumber: stringOrNull(obj.modelNumber),
    manufacturer: stringOrNull(obj.manufacturer),
    url: stringOrNull(obj.url),
    addToCartUrl: stringOrNull(obj.addToCartUrl),
    mobileUrl: stringOrNull(obj.mobileUrl),
    salePrice: numberOrNull(obj.salePrice),
    regularPrice: numberOrNull(obj.regularPrice),
    onSale: obj.onSale === true,
    percentSavings: numberOrNull(obj.percentSavings),
    dollarSavings: numberOrNull(obj.dollarSavings),
    inStoreAvailability: boolOrNull(obj.inStoreAvailability),
    inStoreAvailabilityText: proseOrNull(obj.inStoreAvailabilityText),
    onlineAvailability: boolOrNull(obj.onlineAvailability),
    onlineAvailabilityText: proseOrNull(obj.onlineAvailabilityText),
    orderable: stringOrNull(obj.orderable),
    freeShipping: boolOrNull(obj.freeShipping),
    shippingCost: numberOrNull(obj.shippingCost),
    releaseDate: stringOrNull(obj.releaseDate),
    image: stringOrNull(obj.image),
    thumbnailImage: stringOrNull(obj.thumbnailImage),
    mediumImage: stringOrNull(obj.mediumImage),
    largeImage: stringOrNull(obj.largeImage),
    longDescription: proseOrNull(obj.longDescription),
    shortDescription: proseOrNull(obj.shortDescription),
    features: stringListFromWrapped(obj.features, 'feature'),
    includedItemList: stringListFromWrapped(
      obj.includedItemList,
      'includedItem',
    ),
    condition: stringOrNull(obj.condition),
    categoryPath: parseCategoryRefs(obj.categoryPath),
    customerReviewAverage: numberOrNull(obj.customerReviewAverage),
    customerReviewCount: numberOrNull(obj.customerReviewCount),
    color: stringOrNull(obj.color),
    weight: stringOrNull(obj.weight),
    height: stringOrNull(obj.height),
    width: stringOrNull(obj.width),
    depth: stringOrNull(obj.depth),
    warrantyLabor: stringOrNull(obj.warrantyLabor),
    warrantyParts: stringOrNull(obj.warrantyParts),
    details: parseDetails(obj.details),
  }
}

/** Parse `facets: { manufacturer: { samsung: 25, … } }` — tolerant of absence. */
function parseFacets(value: unknown): ProductFacets | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined
  }
  const out: ProductFacets = {}
  for (const [attribute, rollup] of Object.entries(value)) {
    if (typeof rollup !== 'object' || rollup === null) continue
    const counts: Record<string, number> = {}
    for (const [name, count] of Object.entries(rollup)) {
      if (typeof count === 'number' && Number.isFinite(count)) {
        counts[name] = count
      }
    }
    if (Object.keys(counts).length > 0) out[attribute] = counts
  }
  return Object.keys(out).length > 0 ? out : undefined
}

export function parseProductsPage(raw: unknown): ProductsPage {
  const obj = asRecord(raw, 'products response')
  const products = Array.isArray(obj.products)
    ? obj.products.map(parseProduct)
    : []
  const facets = parseFacets(obj.facets)
  return {
    total: numberOrNull(obj.total) ?? products.length,
    currentPage: numberOrNull(obj.currentPage) ?? 1,
    totalPages: numberOrNull(obj.totalPages) ?? 1,
    products,
    ...(facets !== undefined ? { facets } : {}),
  }
}

// ───────────────────────────── Categories ─────────────────────────────

/**
 * v1 (models/category.dart) kept subCategories as bare id strings and then
 * re-fetched each one for its name (getSubcategories N+1). The API already
 * returns `{id, name}` pairs — keep them and the N+1 disappears (IMA-4).
 */
export interface BestBuyCategory {
  id: string
  name: string
  subCategories: CategoryRef[]
  /** Root → this category, e.g. Best Buy > Computers > Laptops. */
  path: CategoryRef[]
}

export interface CategoryRef {
  id: string
  name: string
}

export interface CategoriesPage {
  total: number
  currentPage: number
  totalPages: number
  categories: BestBuyCategory[]
  /** True when served stale from a logically-expired envelope (see grace). */
  stale?: true
}

function parseCategoryRefs(value: unknown): CategoryRef[] {
  if (!Array.isArray(value)) return []
  const refs: CategoryRef[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const obj = item as Record<string, unknown>
    const id = stringOrNull(obj.id)
    const name = stringOrNull(obj.name)
    if (id !== null && name !== null) refs.push({ id, name })
  }
  return refs
}

export function parseCategory(raw: unknown): BestBuyCategory {
  const obj = asRecord(raw, 'category')
  const id = stringOrNull(obj.id)
  const name = stringOrNull(obj.name)
  if (id === null || name === null) {
    throw new BestBuyParseError('Category missing required id/name')
  }
  return {
    id,
    name,
    subCategories: parseCategoryRefs(obj.subCategories),
    path: parseCategoryRefs(obj.path),
  }
}

export function parseCategoriesPage(raw: unknown): CategoriesPage {
  const obj = asRecord(raw, 'categories response')
  const categories = Array.isArray(obj.categories)
    ? obj.categories.map(parseCategory)
    : []
  return {
    total: numberOrNull(obj.total) ?? categories.length,
    currentPage: numberOrNull(obj.currentPage) ?? 1,
    totalPages: numberOrNull(obj.totalPages) ?? 1,
    categories,
  }
}

// ─────────────────────────── Store availability ───────────────────────────

/** One store stocking a product (models/store.dart StoreAvailability). */
export interface StoreAvailability {
  storeId: number
  name: string | null
  address: string | null
  city: string | null
  state: string | null
  distance: number | null
  lowStock: boolean
  minPickupHours: number | null
}

export interface StoreAvailabilityPage {
  ispuEligible: boolean
  stores: StoreAvailability[]
  /** Store availability never grace-serves stale, so this is always absent. */
  stale?: true
}

export function parseStoreAvailability(raw: unknown): StoreAvailability {
  const obj = asRecord(raw, 'store')
  const storeId = numberOrNull(obj.storeID ?? obj.storeId)
  if (storeId === null) {
    throw new BestBuyParseError('Store availability missing storeID')
  }
  return {
    storeId,
    name: stringOrNull(obj.longName) ?? stringOrNull(obj.name),
    address: stringOrNull(obj.address),
    city: stringOrNull(obj.city),
    state: stringOrNull(obj.region) ?? stringOrNull(obj.state),
    distance: numberOrNull(obj.distance),
    lowStock: obj.lowStock === true,
    minPickupHours: numberOrNull(obj.minPickupHours),
  }
}

export function parseStoreAvailabilityPage(
  raw: unknown,
): StoreAvailabilityPage {
  const obj = asRecord(raw, 'stores response')
  const stores = Array.isArray(obj.stores)
    ? obj.stores.map(parseStoreAvailability)
    : []
  return {
    ispuEligible: obj.ispuEligible === true,
    stores,
  }
}
