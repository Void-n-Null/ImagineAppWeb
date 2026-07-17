import { describe, expect, it } from 'vitest'
import type { BestBuyProduct } from '#/server/bestbuy/types'
import { buildCustomerQuote } from './customer-quote'

function product(overrides: Partial<BestBuyProduct>): BestBuyProduct {
  return {
    sku: 6537363,
    name: 'Sony 55" X77L 4K TV',
    modelNumber: 'KD55X77L',
    salePrice: 399.99,
    regularPrice: 499.99,
    onSale: true,
    inStoreAvailability: true,
    onlineAvailability: true,
    url: 'https://www.bestbuy.com/site/6537363.p',
    ...overrides,
  } as BestBuyProduct
}

describe('buildCustomerQuote', () => {
  it('builds the full SMS-ready block', () => {
    expect(buildCustomerQuote(product({}))).toBe(
      [
        'Sony 55" X77L 4K TV',
        '$399.99 (reg. $499.99 — save $100)',
        'SKU 6537363 · Model KD55X77L',
        'Sold in stores · Available online',
        'https://www.bestbuy.com/site/6537363.p',
      ].join('\n'),
    )
  })

  it('omits what it cannot honestly claim', () => {
    const quote = buildCustomerQuote(
      product({
        salePrice: null,
        regularPrice: null,
        onSale: false,
        modelNumber: null,
        inStoreAvailability: null,
        onlineAvailability: null,
        url: null,
      }),
    )
    expect(quote).toBe(['Sony 55" X77L 4K TV', 'SKU 6537363'].join('\n'))
  })
})
