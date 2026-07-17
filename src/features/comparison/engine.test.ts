import { describe, expect, it } from 'vitest'
import type { BestBuyProduct } from '#/server/bestbuy/types'
import { buildComparison } from './engine'

function product(overrides: Partial<BestBuyProduct>): BestBuyProduct {
  return {
    sku: 1,
    name: 'Product',
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
    details: [],
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
    ...overrides,
  }
}

describe('buildComparison', () => {
  it('drops rows where no product states a value', () => {
    const table = buildComparison([
      product({ sku: 1, salePrice: 100 }),
      product({ sku: 2, salePrice: 200 }),
    ])
    expect(table.rows.map((r) => r.label)).toEqual(['Price'])
  })

  it('marks the lowest price as best', () => {
    const table = buildComparison([
      product({ sku: 1, salePrice: 299.99 }),
      product({ sku: 2, salePrice: 199.99 }),
      product({ sku: 3, salePrice: 399 }),
    ])
    const price = table.rows.find((r) => r.label === 'Price')
    expect(price?.bestIndex).toBe(1)
    expect(price?.differs).toBe(true)
  })

  it('marks the highest rating as best', () => {
    const table = buildComparison([
      product({ sku: 1, customerReviewAverage: 4.2, customerReviewCount: 10 }),
      product({ sku: 2, customerReviewAverage: 4.8, customerReviewCount: 5 }),
    ])
    const rating = table.rows.find((r) => r.label === 'Rating')
    expect(rating?.bestIndex).toBe(1)
    expect(rating?.values[1]).toBe('4.8 ★ (5)')
  })

  it('declares no best on a tie', () => {
    const table = buildComparison([
      product({ sku: 1, salePrice: 100 }),
      product({ sku: 2, salePrice: 100 }),
      product({ sku: 3, salePrice: 150 }),
    ])
    const price = table.rows.find((r) => r.label === 'Price')
    expect(price?.bestIndex).toBeUndefined()
  })

  it('falls back to regularPrice when salePrice is absent', () => {
    const table = buildComparison([
      product({ sku: 1, regularPrice: 500 }),
      product({ sku: 2, salePrice: 450 }),
    ])
    const price = table.rows.find((r) => r.label === 'Price')
    expect(price?.values).toEqual(['$500', '$450'])
    expect(price?.bestIndex).toBe(1)
  })

  it('shows the regular-price row only for on-sale products', () => {
    const table = buildComparison([
      product({ sku: 1, salePrice: 80, regularPrice: 100, onSale: true }),
      product({ sku: 2, salePrice: 90, regularPrice: 90 }),
    ])
    const regular = table.rows.find((r) => r.label === 'Regular price')
    expect(regular?.values).toEqual(['$100', null])
  })

  it('differs is false when all stated values match (case-insensitive)', () => {
    const table = buildComparison([
      product({ sku: 1, manufacturer: 'Samsung', salePrice: 1 }),
      product({ sku: 2, manufacturer: 'samsung', salePrice: 1 }),
    ])
    const brand = table.rows.find((r) => r.label === 'Brand')
    expect(brand?.differs).toBe(false)
  })

  it('differs is false when only one product states the value', () => {
    const table = buildComparison([
      product({ sku: 1, color: 'Black' }),
      product({ sku: 2 }),
    ])
    const color = table.rows.find((r) => r.label === 'Color')
    expect(color?.differs).toBe(false)
    expect(color?.values).toEqual(['Black', null])
  })

  it('summarizes availability from the chain-wide flags', () => {
    const table = buildComparison([
      product({ sku: 1, inStoreAvailability: true, onlineAvailability: true }),
      product({ sku: 2, inStoreAvailability: false, onlineAvailability: true }),
      product({
        sku: 3,
        inStoreAvailability: false,
        onlineAvailability: false,
      }),
    ])
    const availability = table.rows.find((r) => r.label === 'Availability')
    expect(availability?.values).toEqual([
      'Stores + online',
      'Online only',
      'Unavailable',
    ])
  })

  it('uses the leaf category name', () => {
    const table = buildComparison([
      product({
        sku: 1,
        categoryPath: [
          { id: 'cat00000', name: 'Best Buy' },
          { id: 'abcat0101000', name: 'TVs' },
        ],
      }),
      product({ sku: 2 }),
    ])
    const category = table.rows.find((r) => r.label === 'Category')
    expect(category?.values[0]).toBe('TVs')
  })
})
