import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentHost } from '../tool'
import type { BestBuyProduct } from '#/server/bestbuy/types'

const getProductDetail = vi.fn()
vi.mock('#/server/functions/get-product-detail', () => ({
  getProductDetail: (args: unknown) => getProductDetail(args),
}))

import { computeTvFitTool } from './compute-tv-fit-tool'

const host: AgentHost = {
  requestScan: async () => ({ status: 'cancelled' }),
  cart: {
    items: () => [],
    add: () => undefined,
    remove: () => null,
    clear: () => 0,
  },
  clock: () => ({ iso: '2026-07-18T12:00:00.000Z', timeZone: 'UTC' }),
}

function product(overrides: Partial<BestBuyProduct> = {}): BestBuyProduct {
  return {
    sku: 123456,
    name: 'Test TV',
    upc: null,
    type: null,
    modelNumber: null,
    manufacturer: null,
    url: null,
    addToCartUrl: null,
    mobileUrl: null,
    salePrice: null,
    regularPrice: null,
    onSale: false,
    percentSavings: null,
    dollarSavings: null,
    inStoreAvailability: null,
    inStoreAvailabilityText: null,
    onlineAvailability: null,
    onlineAvailabilityText: null,
    orderable: null,
    freeShipping: null,
    shippingCost: null,
    releaseDate: null,
    image: null,
    thumbnailImage: null,
    mediumImage: null,
    largeImage: null,
    longDescription: null,
    shortDescription: null,
    features: [],
    includedItemList: [],
    condition: null,
    categoryPath: [],
    customerReviewAverage: null,
    customerReviewCount: null,
    color: null,
    weight: null,
    height: '31 inches',
    width: '56.9 inches',
    depth: null,
    warrantyLabor: null,
    warrantyParts: null,
    details: [],
    ...overrides,
  }
}

const args = {
  sku: 123456,
  vehicleLabel: '2019 Honda CR-V',
  cargoLengthIn: 55.1,
  openingWidthIn: 42,
  openingHeightIn: 31,
  specsSource: 'https://example.com/cr-v-specs',
  estimated: true,
}

describe('computeTvFitTool', () => {
  beforeEach(() => {
    getProductDetail.mockReset()
  })

  it('fetches the product and emits a fit verdict token', async () => {
    getProductDetail.mockResolvedValue({ status: 'found', product: product() })

    const result = await computeTvFitTool.execute(args, host)

    expect(getProductDetail).toHaveBeenCalledWith({ data: { sku: 123456 } })
    expect(result).toContain('Flat transport is not recommended for panels.')
    expect(result).toMatch(
      /\[FitVerdict\(123456,\d+,(upright|tilted|flat|none),2019%20Honda%20CR-V,1,38\.0,9\.0,42\.0,31\.0\)\]/,
    )
  })

  it('reports that the fit check is unavailable when the product has no dimensions', async () => {
    getProductDetail.mockResolvedValue({
      status: 'found',
      product: product({ width: null, height: null }),
    })

    const result = await computeTvFitTool.execute(args, host)

    expect(result).toContain("fit check isn't available for this product")
    expect(result).not.toContain('[FitVerdict(')
  })
})
