import { createServerFn } from '@tanstack/react-start'
import { getBestBuyClient } from '#/server/bestbuy/client'
import { BestBuyError, BestBuyHttpError } from '#/server/bestbuy/errors'
import type { BestBuyProduct } from '#/server/bestbuy/types'

/**
 * Batch product fetch by SKUs — the backend for compare_products (IMA-6).
 * Rides the client's entity-keyed batch path (mget + one `sku in(...)`
 * request for the misses), so comparing products the user just searched is
 * usually zero Best Buy requests.
 */

export type ProductsBatchResult =
  | { status: 'ok'; products: BestBuyProduct[]; missingSkus: number[] }
  | { status: 'error'; message: string; rateLimited: boolean }

const MAX_BATCH = 10

function validateInput(input: unknown): { skus: number[] } {
  const obj = (input ?? {}) as Record<string, unknown>
  if (!Array.isArray(obj.skus)) {
    throw new Error('getProductsBatch expects { skus: number[] }')
  }
  const skus = [
    ...new Set(
      obj.skus.filter(
        (s): s is number =>
          typeof s === 'number' && Number.isSafeInteger(s) && s > 0,
      ),
    ),
  ].slice(0, MAX_BATCH)
  if (skus.length === 0) {
    throw new Error('getProductsBatch expects at least one valid SKU')
  }
  return { skus }
}

export const getProductsBatch = createServerFn({ method: 'GET' })
  .inputValidator(validateInput)
  .handler(async ({ data }): Promise<ProductsBatchResult> => {
    try {
      const found = await getBestBuyClient().productsBySkus(data.skus)
      const products: BestBuyProduct[] = []
      const missingSkus: number[] = []
      for (const sku of data.skus) {
        const product = found.get(sku)
        if (product) products.push(product)
        else missingSkus.push(sku)
      }
      return { status: 'ok', products, missingSkus }
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
