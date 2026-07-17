// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import type { BestBuyProduct } from '#/server/bestbuy/types'
import {
  addCompareEntry,
  COMPARE_LIMIT,
  clearCompareTray,
  getCompareEntries,
  removeCompareEntry,
  toggleCompareEntry,
} from './compare-tray'

function product(sku: number): BestBuyProduct {
  return { sku, name: `Product ${sku}` } as BestBuyProduct
}

describe('compare tray', () => {
  beforeEach(() => {
    localStorage.clear()
    clearCompareTray()
  })

  it('toggle adds then removes, reporting membership', () => {
    expect(toggleCompareEntry(product(1))).toBe(true)
    expect(getCompareEntries()).toEqual([{ sku: 1, name: 'Product 1' }])
    expect(toggleCompareEntry(product(1))).toBe(false)
    expect(getCompareEntries()).toEqual([])
  })

  it('rotates the oldest entry out at capacity instead of refusing', () => {
    for (let sku = 1; sku <= COMPARE_LIMIT + 1; sku++) {
      toggleCompareEntry(product(sku))
    }
    const skus = getCompareEntries().map((entry) => entry.sku)
    expect(skus).toHaveLength(COMPARE_LIMIT)
    expect(skus[0]).toBe(2) // SKU 1 rotated out
    expect(skus.at(-1)).toBe(COMPARE_LIMIT + 1)
  })

  it('survives garbage in storage', () => {
    localStorage.setItem('imagine:compare-tray', '{not json')
    expect(getCompareEntries()).toEqual([])
  })

  // Scan collection (IMA-36): a re-scan must never REMOVE the way toggle would.
  it('add is idempotent — re-adding reports false and keeps the entry', () => {
    expect(addCompareEntry(product(1))).toBe(true)
    expect(addCompareEntry(product(1))).toBe(false)
    expect(getCompareEntries()).toEqual([{ sku: 1, name: 'Product 1' }])
  })

  it('add rotates the oldest entry out at capacity', () => {
    for (let sku = 1; sku <= COMPARE_LIMIT + 1; sku++) {
      addCompareEntry(product(sku))
    }
    const skus = getCompareEntries().map((entry) => entry.sku)
    expect(skus).toHaveLength(COMPARE_LIMIT)
    expect(skus[0]).toBe(2)
    expect(skus.at(-1)).toBe(COMPARE_LIMIT + 1)
  })

  it('remove drops one entry by SKU and tolerates unknown SKUs', () => {
    addCompareEntry(product(1))
    addCompareEntry(product(2))
    removeCompareEntry(1)
    expect(getCompareEntries()).toEqual([{ sku: 2, name: 'Product 2' }])
    removeCompareEntry(999)
    expect(getCompareEntries()).toEqual([{ sku: 2, name: 'Product 2' }])
  })
})
