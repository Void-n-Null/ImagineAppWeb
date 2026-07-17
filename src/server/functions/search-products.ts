import { createServerFn } from '@tanstack/react-start'
import { getBestBuyClient } from '#/server/bestbuy/client'
import { BestBuyError, BestBuyHttpError } from '#/server/bestbuy/errors'
import {
  ProductSearchBuilder,
  type ProductSort,
} from '#/server/bestbuy/search-builder'
import type { ProductsPage } from '#/server/bestbuy/types'

export type SearchProductsResult =
  | { status: 'ok'; page: ProductsPage }
  | { status: 'error'; message: string; rateLimited: boolean }

/**
 * Human-facing sort options (IMA-10) — a curated subset of ProductSort.
 * Popularity (review volume) stays the default: it is the measured proxy
 * that makes results floor-relevant (IMA-DOC-4).
 */
export const SEARCH_SORTS = [
  'customerReviewCount.dsc',
  'salePrice.asc',
  'salePrice.dsc',
  'customerReviewAverage.dsc',
  'releaseDate.dsc',
] as const satisfies readonly ProductSort[]

export type SearchSort = (typeof SEARCH_SORTS)[number]

export function isSearchSort(value: unknown): value is SearchSort {
  return (
    typeof value === 'string' &&
    (SEARCH_SORTS as readonly string[]).includes(value)
  )
}

export interface SearchProductsInput {
  query: string
  page: number
  sort?: SearchSort
  minPrice?: number
  maxPrice?: number
  onSale?: boolean
  /** Manufacturer name — facet values (lowercased) work verbatim (measured). */
  brand?: string
}

function priceOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.min(value, 1_000_000)
    : undefined
}

function validateInput(input: unknown): SearchProductsInput {
  const obj = input as Partial<SearchProductsInput> | null
  if (typeof obj?.query !== 'string') {
    throw new Error('searchProducts expects { query, page? }')
  }
  const page =
    typeof obj.page === 'number' &&
    Number.isSafeInteger(obj.page) &&
    obj.page >= 1
      ? Math.min(obj.page, 100)
      : 1
  return {
    query: obj.query.slice(0, 200),
    page,
    sort: isSearchSort(obj.sort) ? obj.sort : undefined,
    minPrice: priceOrUndefined(obj.minPrice),
    maxPrice: priceOrUndefined(obj.maxPrice),
    onSale: obj.onSale === true ? true : undefined,
    brand:
      typeof obj.brand === 'string' && obj.brand.trim().length > 0
        ? obj.brand.trim().slice(0, 60)
        : undefined,
  }
}

const EMPTY_PAGE: ProductsPage = {
  total: 0,
  currentPage: 1,
  totalPages: 0,
  products: [],
}

/**
 * Keyword product search through the cached Best Buy proxy, using the
 * measured universal recipe (IMA-DOC-4): normalized name tokens + floor-noise
 * exclusions + new-condition, popularity-ordered by review volume.
 *
 * IMA-10 adds the human filter set (sort / price band / on-sale / brand) —
 * every value passes through the builder's validation and quoting, so user
 * text can't reach the filter grammar raw. Each filter combination is its own
 * shared-Redis cache entry; the brand facet rollup rides on every request so
 * the brand chips need no extra call.
 *
 * Deliberately does NOT filter on inStoreAvailability: the "Sold in stores"
 * toggle is a client-side VIEW filter over these results. One filter variant
 * means both toggle states share the same shared-Redis cache entries, and
 * flipping the toggle costs zero requests. (The flag is chain-wide anyway —
 * see availableInStore(); per-store truth is IMA-24.)
 *
 * The agent (IMA-6) gets richer builder access (categories, facets); this is
 * the human search-bar path.
 */
export const searchProducts = createServerFn({ method: 'GET' })
  .inputValidator(validateInput)
  .handler(async ({ data }): Promise<SearchProductsResult> => {
    const builder = new ProductSearchBuilder()
      .keywords(data.query)
      .excludeFloorNoise()
      .newOnly()
      .page(data.page)
      .pageSize(20)
      .facet('manufacturer', 12)
    if (builder.searchTermCount === 0) {
      return { status: 'ok', page: EMPTY_PAGE }
    }

    if (data.sort !== undefined) builder.sortBy(data.sort)
    if (data.minPrice !== undefined || data.maxPrice !== undefined) {
      builder.priceRange({ min: data.minPrice, max: data.maxPrice })
    }
    if (data.onSale === true) builder.onSaleOnly()
    if (data.brand !== undefined) builder.byManufacturer(data.brand)

    try {
      const { filter, params } = builder.build()
      const page = await getBestBuyClient().products(filter, params)
      return { status: 'ok', page }
    } catch (err) {
      if (err instanceof BestBuyError) {
        const rateLimited = err instanceof BestBuyHttpError && err.isRateLimit
        return {
          status: 'error',
          message: rateLimited
            ? 'Rate limited by Best Buy — retry in a moment'
            : err.message,
          rateLimited,
        }
      }
      throw err
    }
  })
