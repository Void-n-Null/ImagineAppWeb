import { createServerFn } from '@tanstack/react-start'
import { findCategory } from '#/server/bestbuy/category-finder'
import { getBestBuyClient } from '#/server/bestbuy/client'
import { BestBuyError, BestBuyHttpError } from '#/server/bestbuy/errors'
import {
  ProductSearchBuilder,
  type ProductSort,
} from '#/server/bestbuy/search-builder'
import type { ProductsPage } from '#/server/bestbuy/types'

/**
 * The agent's search path (IMA-6) — richer builder access than the human
 * search bar (search-products.ts): category scoping (fuzzy-matched
 * server-side), brand, price band, rating floor, screen-size range, sale and
 * availability filters, and the verified sort recipes (IMA-DOC-4).
 *
 * Model-supplied values are untrusted: everything flows through the builder
 * (the only sanctioned producer of filter expressions), and builder
 * validation failures come back as `status:'error'` VALUES so the model can
 * read the message and self-correct instead of crashing the loop.
 */

export type AgentSortKey =
  | 'popularity'
  | 'rating'
  | 'price_low'
  | 'price_high'
  | 'newest'

const SORT_MAP: Record<AgentSortKey, ProductSort> = {
  popularity: 'customerReviewCount.dsc',
  rating: 'customerReviewAverage.dsc',
  price_low: 'salePrice.asc',
  price_high: 'salePrice.dsc',
  newest: 'releaseDate.dsc',
}

export interface AgentSearchInput {
  query?: string
  /** Free-text category name, fuzzy-matched against the curated table. */
  category?: string
  manufacturer?: string
  minPrice?: number
  maxPrice?: number
  onSale?: boolean
  /** Chain-wide "sold in Best Buy stores" flag — NOT per-store stock. */
  soldInStores?: boolean
  minRating?: number
  screenSizeMin?: number
  screenSizeMax?: number
  sortBy?: AgentSortKey
  page?: number
  pageSize?: number
}

export type AgentSearchResult =
  | {
      status: 'ok'
      page: ProductsPage
      /** Set when `category` fuzzy-matched an entry — tells the model what it actually searched. */
      matchedCategory?: { id: string; name: string }
    }
  | { status: 'error'; message: string; rateLimited: boolean }

function optionalString(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.slice(0, max)
    : undefined
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function validateInput(input: unknown): AgentSearchInput {
  const obj = (input ?? {}) as Record<string, unknown>
  const sortBy = obj.sortBy
  return {
    query: optionalString(obj.query, 200),
    category: optionalString(obj.category, 80),
    manufacturer: optionalString(obj.manufacturer, 80),
    minPrice: optionalNumber(obj.minPrice),
    maxPrice: optionalNumber(obj.maxPrice),
    onSale: obj.onSale === true,
    soldInStores: obj.soldInStores === true,
    minRating: optionalNumber(obj.minRating),
    screenSizeMin: optionalNumber(obj.screenSizeMin),
    screenSizeMax: optionalNumber(obj.screenSizeMax),
    sortBy:
      typeof sortBy === 'string' && sortBy in SORT_MAP
        ? (sortBy as AgentSortKey)
        : undefined,
    page: optionalNumber(obj.page),
    pageSize: optionalNumber(obj.pageSize),
  }
}

export const agentSearchProducts = createServerFn({ method: 'GET' })
  .inputValidator(validateInput)
  .handler(async ({ data }): Promise<AgentSearchResult> => {
    try {
      const builder = new ProductSearchBuilder()
        .excludeFloorNoise()
        .newOnly()
        .page(data.page ?? 1)
        .pageSize(Math.min(Math.max(Math.trunc(data.pageSize ?? 8), 1), 20))

      if (data.query) builder.keywords(data.query)

      let matchedCategory: { id: string; name: string } | undefined
      if (data.category) {
        const match = findCategory(data.category)
        if (match) {
          builder.inCategory(match.entry.id)
          matchedCategory = { id: match.entry.id, name: match.entry.name }
        }
      }

      if (data.manufacturer) builder.byManufacturer(data.manufacturer)
      if (data.minPrice !== undefined || data.maxPrice !== undefined) {
        builder.priceRange({ min: data.minPrice, max: data.maxPrice })
      }
      if (data.onSale) builder.onSaleOnly()
      if (data.soldInStores) builder.availableInStore()
      if (data.minRating !== undefined) builder.minRating(data.minRating)
      if (
        data.screenSizeMin !== undefined ||
        data.screenSizeMax !== undefined
      ) {
        builder.screenSizeBetween(
          data.screenSizeMin ?? 0,
          data.screenSizeMax ?? 999,
        )
      }
      if (data.sortBy) builder.sortBy(SORT_MAP[data.sortBy])

      // Only the noise exclusions present = the model gave us nothing usable.
      if (
        builder.searchTermCount === 0 &&
        !matchedCategory &&
        !data.manufacturer &&
        data.minPrice === undefined &&
        data.maxPrice === undefined &&
        data.screenSizeMin === undefined &&
        data.screenSizeMax === undefined
      ) {
        return {
          status: 'error',
          message:
            'Search needs at least a query, category, manufacturer, price range, or screen size.',
          rateLimited: false,
        }
      }

      const { filter, params } = builder.build()
      const page = await getBestBuyClient().products(filter, params)
      return { status: 'ok', page, matchedCategory }
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
