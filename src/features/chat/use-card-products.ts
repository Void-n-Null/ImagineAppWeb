import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { BestBuyProduct } from '#/server/bestbuy/types'
import { getProductsBatch } from '#/server/functions/get-products-batch'

/**
 * Resolves the SKUs behind a message's rich cards (IMA-7) in ONE query per
 * distinct SKU set, chunked to the batch fn's max. Rides the same
 * entity-keyed Redis path the agent's tools use, so cards for products the
 * model just searched are usually zero Best Buy requests.
 *
 * staleTime is infinite on purpose: within a session a card should never
 * refetch (server cache already expires at the sale rollover), and the
 * sorted-SKU key means every message showing the same products shares one
 * cache entry.
 *
 * placeholderData is the anti-flash guarantee for streaming: each card the
 * model streams in GROWS the SKU set, which is a new query key. Without
 * carry-over, every growth would collapse `products` to empty for a frame
 * and demote all already-rendered cards to skeletons (image unmount = the
 * black flash). Keeping the previous set's map means settled cards never
 * lose their DOM — only the genuinely-new SKU shows a skeleton while
 * `isFetching` covers the gap.
 */

const BATCH_LIMIT = 10

export interface CardProducts {
  /** SKU → product for everything that resolved. */
  products: ReadonlyMap<number, BestBuyProduct>
  /**
   * True while a fetch for the CURRENT SKU set is in flight — an absent
   * SKU means "still loading" rather than "not in the catalog".
   */
  isLoading: boolean
}

const EMPTY: ReadonlyMap<number, BestBuyProduct> = new Map()

export function useCardProducts(skus: number[]): CardProducts {
  const key = [...new Set(skus)].sort((a, b) => a - b)

  const query = useQuery({
    queryKey: ['card-products', key.join(',')],
    enabled: key.length > 0,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<ReadonlyMap<number, BestBuyProduct>> => {
      const chunks: number[][] = []
      for (let i = 0; i < key.length; i += BATCH_LIMIT) {
        chunks.push(key.slice(i, i + BATCH_LIMIT))
      }
      const results = await Promise.all(
        chunks.map((chunk) => getProductsBatch({ data: { skus: chunk } })),
      )
      const map = new Map<number, BestBuyProduct>()
      for (const result of results) {
        if (result.status !== 'ok') continue
        for (const product of result.products) map.set(product.sku, product)
      }
      return map
    },
  })

  return {
    products: query.data ?? EMPTY,
    // isFetching (not isPending): with placeholderData the query reports
    // success while the new set's request is still in flight.
    isLoading: key.length > 0 && (query.isPending || query.isFetching),
  }
}
