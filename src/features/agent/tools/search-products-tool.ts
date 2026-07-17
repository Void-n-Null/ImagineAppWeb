import {
  type AgentSearchInput,
  agentSearchProducts,
} from '#/server/functions/agent-search-products'
import type { AgentTool } from '../tool'
import { formatProductRow } from './format'

/**
 * search_products — the agent's catalog search (IMA-6). Richer than the
 * human search bar: category scoping, brand, price band, rating floor,
 * screen-size range, sale/availability filters, verified sorts.
 */

const SORT_KEYS = [
  'popularity',
  'rating',
  'price_low',
  'price_high',
  'newest',
] as const

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value
    : undefined
}

export const searchProductsTool: AgentTool = {
  name: 'search_products',
  description: `Search the Best Buy product catalog. Returns matching products with SKU, model number, price, rating, and availability.

Search behavior you must know:
- "query" keywords match PRODUCT NAMES ONLY (not descriptions or specs). Use words that appear in a product's name.
- Always prefer adding "category" to narrow results (fuzzy-matched: "Laptops", "TVs", "Headphones", "USB Cables", "Cell Phone Accessories", ...).
- For TV sizes, use screen_size_min/screen_size_max (e.g. 63-67 for "65 inch") instead of putting the size in the query — size tokens in names are unreliable.
- "sold_in_stores" filters to products Best Buy stocks in stores CHAIN-WIDE. It is NOT a stock check for a specific store; use check_store_availability for that.
- Results are sorted by popularity (review volume) unless you pick another sort.`,
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'Keywords matched against product NAMES (e.g. "macbook air", "usb-c hub"). Omit when browsing a category.',
      },
      category: {
        type: 'string',
        description:
          'Category name, fuzzy-matched (e.g. "Laptops", "TVs", "Headphones"). Highly recommended.',
      },
      manufacturer: {
        type: 'string',
        description: 'Brand filter, e.g. "Apple", "Samsung", "Sony".',
      },
      min_price: { type: 'number', description: 'Minimum price in dollars.' },
      max_price: { type: 'number', description: 'Maximum price in dollars.' },
      on_sale: {
        type: 'boolean',
        description: 'Only products currently on sale.',
      },
      sold_in_stores: {
        type: 'boolean',
        description:
          'Only products stocked in Best Buy stores chain-wide (not a per-store stock check).',
      },
      min_rating: {
        type: 'number',
        description: 'Minimum customer rating, 1-5.',
      },
      screen_size_min: {
        type: 'number',
        description: 'Minimum screen size in inches (TVs, monitors).',
      },
      screen_size_max: {
        type: 'number',
        description: 'Maximum screen size in inches (TVs, monitors).',
      },
      sort_by: {
        type: 'string',
        enum: [...SORT_KEYS],
        description: 'Result order. Default "popularity" (review volume).',
      },
      page: {
        type: 'integer',
        description: 'Result page, starting at 1. Use to see more matches.',
      },
      limit: {
        type: 'integer',
        description: 'Results per page, 1-20. Default 8.',
      },
    },
    required: [],
  },
  statusLabel(args) {
    const query = str(args.query) ?? str(args.category)
    return query ? `Searching “${query.slice(0, 40)}”` : 'Searching products'
  },
  async execute(args) {
    const sortBy = str(args.sort_by)
    const input: AgentSearchInput = {
      query: str(args.query),
      category: str(args.category),
      manufacturer: str(args.manufacturer),
      minPrice: num(args.min_price),
      maxPrice: num(args.max_price),
      onSale: args.on_sale === true,
      soldInStores: args.sold_in_stores === true,
      minRating: num(args.min_rating),
      screenSizeMin: num(args.screen_size_min),
      screenSizeMax: num(args.screen_size_max),
      sortBy: SORT_KEYS.find((k) => k === sortBy),
      page: num(args.page),
      pageSize: num(args.limit),
    }

    const result = await agentSearchProducts({ data: input })
    if (result.status === 'error') {
      return `Search failed: ${result.message}`
    }

    const { page, matchedCategory } = result
    const scope = matchedCategory ? ` in ${matchedCategory.name}` : ''
    if (page.products.length === 0) {
      return `No products found${scope}. Try broader keywords, drop a filter, or a different category. Remember: keywords match product NAMES only.`
    }

    const lines = [
      `Found ${page.total} products${scope} (showing ${page.products.length}, page ${page.currentPage}/${page.totalPages}):`,
      '',
    ]
    page.products.forEach((product, i) => {
      lines.push(formatProductRow(i + 1, product))
    })
    if (page.stale === true) {
      lines.push('', 'NOTE: results served from a slightly stale cache.')
    }
    lines.push(
      '',
      'Show any of these to the user as a card: [Product(SKU)] on its own line.',
    )
    return lines.join('\n')
  },
}
