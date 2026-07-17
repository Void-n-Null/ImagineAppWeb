import { createServerFn } from '@tanstack/react-start'
import { getBestBuyClient } from '#/server/bestbuy/client'
import { BestBuyError, BestBuyHttpError } from '#/server/bestbuy/errors'
import type { StoreAvailabilityPage } from '#/server/bestbuy/types'

/**
 * Per-store pickup availability near a postal code — the backend for the
 * agent's check_store_availability tool (IMA-6). This is the REAL per-store
 * check (Stores API), unlike the chain-wide inStoreAvailability flag
 * (IMA-24). Short-TTL cached, never served stale: stock is intraday data.
 */

export type StoreAvailabilityResult =
  | { status: 'ok'; page: StoreAvailabilityPage }
  | { status: 'error'; message: string; rateLimited: boolean }

interface StoreAvailabilityInput {
  sku: number
  postalCode: string
}

function validateInput(input: unknown): StoreAvailabilityInput {
  const obj = (input ?? {}) as Record<string, unknown>
  if (
    typeof obj.sku !== 'number' ||
    !Number.isSafeInteger(obj.sku) ||
    obj.sku <= 0
  ) {
    throw new Error('checkStoreAvailability expects a positive integer sku')
  }
  if (typeof obj.postalCode !== 'string' || obj.postalCode.trim().length < 3) {
    throw new Error('checkStoreAvailability expects a postalCode string')
  }
  return { sku: obj.sku, postalCode: obj.postalCode.trim().slice(0, 12) }
}

export const checkStoreAvailability = createServerFn({ method: 'GET' })
  .inputValidator(validateInput)
  .handler(async ({ data }): Promise<StoreAvailabilityResult> => {
    try {
      const page = await getBestBuyClient().storeAvailability(data.sku, {
        postalCode: data.postalCode,
      })
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
