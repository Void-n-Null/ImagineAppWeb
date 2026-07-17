import { describe, expect, it } from 'vitest'
import {
  CATEGORY_TABLE,
  categoryById,
  findCategories,
  findCategory,
  suggestCategoryForSearch,
} from './category-finder'

describe('findCategory', () => {
  it('resolves exact names', () => {
    const match = findCategory('Laptops')
    expect(match?.entry.id).toBe('abcat0502000')
    expect(match?.isExactMatch).toBe(true)
  })

  it('resolves keyword aliases', () => {
    expect(findCategory('macbook')?.entry.id).toBe('abcat0502000')
    expect(findCategory('usb-c')?.entry.id).toBe('abcat0515013')
    expect(findCategory('ps5')?.entry.id).toBe('abcat0701000')
    expect(findCategory('roomba')?.entry.id).toBe('abcat0908000')
  })

  it('resolves fuzzy near-misses', () => {
    expect(findCategory('laptop')?.entry.id).toBe('abcat0502000')
    expect(findCategory('televisions')?.entry.id).toBe('abcat0101000')
  })

  it('routes USB cables to the LIVE category (abcat0515013, not dead 018)', () => {
    expect(findCategory('usb cables')?.entry.id).toBe('abcat0515013')
  })

  it('returns null for gibberish below threshold', () => {
    expect(findCategory('zzqqxx')).toBeNull()
    expect(findCategory('')).toBeNull()
  })
})

describe('findCategories', () => {
  it('returns ranked multiple matches', () => {
    const matches = findCategories('tv', { limit: 5 })
    expect(matches.length).toBeGreaterThan(1)
    expect(matches[0].score).toBeGreaterThanOrEqual(matches[1].score)
    expect(matches.map((m) => m.entry.id)).toContain('abcat0101000')
  })

  it('respects the limit', () => {
    expect(findCategories('tv', { limit: 2 }).length).toBeLessThanOrEqual(2)
  })
})

describe('suggestCategoryForSearch', () => {
  it('suggests from a full product query via individual words', () => {
    expect(suggestCategoryForSearch('cheap macbook for school')?.entry.id).toBe(
      'abcat0502000',
    )
  })

  it('stays null when nothing fits', () => {
    expect(suggestCategoryForSearch('xk9 blorp')).toBeNull()
  })
})

describe('categoryById / table integrity', () => {
  it('looks up by id', () => {
    expect(categoryById('abcat0101000')?.name).toBe('TVs')
    expect(categoryById('nope')).toBeNull()
  })

  it('has no duplicate ids and only grammar-safe ids', () => {
    const ids = CATEGORY_TABLE.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) {
      expect(id).toMatch(/^[a-zA-Z0-9]+$/)
    }
  })
})
