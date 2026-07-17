import { createServerFn } from '@tanstack/react-start'
import { identifyScan, type ProductIdentifier } from '#/lib/scan-identifier'
import { getBestBuyClient } from '#/server/bestbuy/client'
import { BestBuyError, BestBuyHttpError } from '#/server/bestbuy/errors'
import type { BestBuyProduct } from '#/server/bestbuy/types'

export type ScanLookupResult =
  | {
      status: 'found'
      identifier: ProductIdentifier
      product: BestBuyProduct
      /** True when the product was served stale (a refresh failed transiently). */
      stale?: boolean
    }
  | { status: 'not_found'; identifier: ProductIdentifier }
  | {
      status: 'unrecognized'
      /** Why the payload wasn't a product code, for the UI to explain. */
      reason?: 'too_short' | 'not_product'
    }
  | { status: 'error'; message: string; rateLimited: boolean }

interface ScanLookupInput {
  rawValue: string
  format: string
}

function validateInput(input: unknown): ScanLookupInput {
  const obj = input as Partial<ScanLookupInput> | null
  if (typeof obj?.rawValue !== 'string' || typeof obj?.format !== 'string') {
    throw new Error('lookupScannedProduct expects { rawValue, format }')
  }
  return {
    rawValue: obj.rawValue.slice(0, 512),
    format: obj.format.slice(0, 32),
  }
}

/**
 * Scan payload → Best Buy product. Runs server-side so the API key stays out
 * of the browser and api.bestbuy.com's missing CORS headers never matter.
 *
 * API failures come back as a value (`status: 'error'`) rather than a thrown
 * serialized error: rate limits are an expected runtime condition on a shared
 * 5-req/sec key, not an exceptional crash.
 */
/** Never fire more than this many Best Buy lookups per scan: candidates are
 *  tried sequentially against a shared 5-req/sec key (IMA-DOC-2), so an
 *  ambiguous scan must not fan out into a burst. Two covers UPC-then-SKU. */
const MAX_LOOKUPS = 2

export const lookupScannedProduct = createServerFn({ method: 'GET' })
  .inputValidator(validateInput)
  .handler(async ({ data }): Promise<ScanLookupResult> => {
    const classification = identifyScan(data.rawValue, data.format)
    // Only the empty-candidate arm carries `reason`, so `'reason' in …`
    // discriminates the union (a tuple-length check does not, in TS).
    if ('reason' in classification) {
      return { status: 'unrecognized', reason: classification.reason }
    }

    const client = getBestBuyClient()
    const candidates = classification.candidates.slice(0, MAX_LOOKUPS)

    // Try candidates in priority order, SEQUENTIALLY — never in parallel: the
    // key is rate-limited and the second candidate is only a fallback for when
    // the first misses. First hit wins. Subsumes v1's `fallbackToSku`, which
    // also retried on thrown errors, so we defer a caught BestBuyError until
    // every candidate has been exhausted.
    let deferredError: ScanLookupResult | null = null
    for (const identifier of candidates) {
      try {
        const product =
          identifier.kind === 'sku'
            ? await client.productBySku(identifier.sku)
            : await client.productByUpc(identifier.upc)
        if (product) {
          return {
            status: 'found',
            identifier,
            product,
            stale: product.stale === true,
          }
        }
        // Miss (not an error): fall through to the next candidate.
      } catch (err) {
        if (err instanceof BestBuyError) {
          const rateLimited = err instanceof BestBuyHttpError && err.isRateLimit
          deferredError = {
            status: 'error',
            message: rateLimited
              ? 'Rate limited by Best Buy — retry in a moment'
              : err.message,
            rateLimited,
          }
          // Try the next candidate before surfacing the error (v1 parity).
          continue
        }
        throw err
      }
    }

    // Every candidate missed or errored. Prefer a real error over not_found so
    // rate limits don't masquerade as "no such product".
    if (deferredError) return deferredError
    return { status: 'not_found', identifier: candidates[0] }
  })
