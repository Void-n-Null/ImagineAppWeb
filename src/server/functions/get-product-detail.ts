import { createServerFn } from '@tanstack/react-start'
import { getBestBuyClient } from '#/server/bestbuy/client'
import { BestBuyError, BestBuyHttpError } from '#/server/bestbuy/errors'
import type { BestBuyProduct } from '#/server/bestbuy/types'

/**
 * Direct product fetch by SKU or UPC — the backend for the agent's
 * analyze_product tool (IMA-6) and the composer's SKU-attach path. The
 * cached DTO is already the full attribute superset, so "detail" costs the
 * same request as any lookup.
 */

export type ProductDetailResult =
  | { status: 'found'; product: BestBuyProduct }
  | { status: 'not_found' }
  | { status: 'error'; message: string; rateLimited: boolean }

interface ProductDetailInput {
  sku?: number
  upc?: string
}

function validateInput(input: unknown): ProductDetailInput {
  const obj = (input ?? {}) as Record<string, unknown>
  const sku =
    typeof obj.sku === 'number' && Number.isSafeInteger(obj.sku) && obj.sku > 0
      ? obj.sku
      : undefined
  const upc =
    typeof obj.upc === 'string' && /^\d{6,14}$/.test(obj.upc.trim())
      ? obj.upc.trim()
      : undefined
  if (sku === undefined && upc === undefined) {
    throw new Error('getProductDetail expects { sku } or { upc }')
  }
  return { sku, upc }
}

export const getProductDetail = createServerFn({ method: 'GET' })
  .inputValidator(validateInput)
  .handler(async ({ data }): Promise<ProductDetailResult> => {
    const client = getBestBuyClient()
    try {
      const product =
        data.sku !== undefined
          ? await client.productBySku(data.sku)
          : await client.productByUpc(data.upc as string)
      return product ? { status: 'found', product } : { status: 'not_found' }
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
