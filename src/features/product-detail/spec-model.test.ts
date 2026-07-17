import { describe, expect, it } from 'vitest'
import type { BestBuyProduct } from '#/server/bestbuy/types'
import {
  buildSpecRows,
  dimensionLine,
  parseMeasurement,
  toImperialShort,
  toMetric,
} from './spec-model'

function product(overrides: Partial<BestBuyProduct>): BestBuyProduct {
  return {
    sku: 1,
    name: 'Test Product',
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
    height: null,
    width: null,
    depth: null,
    warrantyLabor: null,
    warrantyParts: null,
    details: [],
    ...overrides,
  }
}

describe('buildSpecRows', () => {
  it('curated rows lead, details follow', () => {
    const rows = buildSpecRows(
      product({
        manufacturer: 'Sony',
        details: [{ name: 'Screen Size', value: '55 inches' }],
      }),
    )
    expect(rows[0]).toEqual({ label: 'Brand', value: 'Sony', curated: true })
    expect(rows.at(-1)).toEqual({
      label: 'Screen Size',
      value: '55 inches',
      curated: false,
    })
  })

  it('drops detail rows that restate curated fields', () => {
    const rows = buildSpecRows(
      product({
        manufacturer: 'Sony',
        color: 'Black',
        details: [
          { name: 'Brand', value: 'Sony' },
          { name: 'Color Category', value: 'Black' },
          { name: 'Product Weight', value: '32 pounds' },
          { name: 'Screen Size', value: '55 inches' },
        ],
      }),
    )
    expect(rows.map((r) => r.label)).toEqual(['Brand', 'Color', 'Screen Size'])
  })

  it('drops exact duplicate detail rows and product-name echoes', () => {
    const rows = buildSpecRows(
      product({
        name: 'Sony 55" X77L TV',
        details: [
          { name: 'Product Title', value: 'Sony 55" X77L TV' },
          { name: 'Screen Size', value: '55 inches' },
          { name: 'Screen Size', value: '55 inches' },
        ],
      }),
    )
    expect(rows).toEqual([
      { label: 'Screen Size', value: '55 inches', curated: false },
    ])
  })
})

describe('measurements', () => {
  it('parses BB unit-suffixed strings', () => {
    expect(parseMeasurement('28.9 inches')).toEqual({
      value: 28.9,
      unit: 'inches',
    })
    expect(parseMeasurement('6.3 lbs.')).toEqual({
      value: 6.3,
      unit: 'pounds',
    })
    expect(parseMeasurement('roughly big')).toBeNull()
  })

  it('converts to metric', () => {
    expect(toMetric({ value: 10, unit: 'inches' })).toBe('25.4 cm')
    expect(toMetric({ value: 32.4, unit: 'pounds' })).toBe('14.7 kg')
    expect(toMetric({ value: 2, unit: 'pounds' })).toBe('907 g')
  })

  it('renders compact imperial', () => {
    expect(toImperialShort({ value: 48.63, unit: 'inches' })).toBe('48.6″')
    expect(toImperialShort({ value: 32.4, unit: 'pounds' })).toBe('32.4 lb')
  })
})

describe('dimensionLine', () => {
  const tv = product({
    width: '48.63 inches',
    height: '28.03 inches',
    depth: '2.91 inches',
  })

  it('assembles W × H × D in both unit systems', () => {
    expect(dimensionLine(tv, false)).toBe('48.6″ W × 28″ H × 2.9″ D')
    expect(dimensionLine(tv, true)).toBe('123.5 cm W × 71.2 cm H × 7.4 cm D')
  })

  it('never renders a half-true line', () => {
    expect(dimensionLine(product({ width: '10 inches' }), false)).toBeNull()
    expect(
      dimensionLine(
        product({
          width: '10 inches',
          height: 'unknowable',
          depth: '2 inches',
        }),
        false,
      ),
    ).toBeNull()
  })
})
