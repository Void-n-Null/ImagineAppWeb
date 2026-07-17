import { describe, expect, it } from 'vitest'
import { normalizeSearchTerms } from './search-terms'

describe('normalizeSearchTerms', () => {
  it('is order-independent: reordered terms produce the same tokens', () => {
    const a = normalizeSearchTerms('M4 MacBook Air')
    const b = normalizeSearchTerms('air macbook m4')
    expect(a).toEqual(b)
    expect(a).toEqual(['air', 'm4', 'macbook'])
  })

  it('dedupes repeated words', () => {
    expect(normalizeSearchTerms('macbook macbook air')).toEqual([
      'air',
      'macbook',
    ])
  })

  it('strips filter metacharacters that could break the expression', () => {
    const terms = normalizeSearchTerms('laptop) OR sku=1&onSale=true')
    for (const term of terms) {
      expect(term).toMatch(/^[a-z0-9.-]+$/)
    }
  })

  it('expands measured hard-zero fused tokens (usbc → usb-c)', () => {
    expect(normalizeSearchTerms('usbc hub')).toEqual(['hub', 'usb-c'])
    expect(normalizeSearchTerms('typec charger')).toEqual(['charger', 'type-c'])
  })

  it('keeps hyphenated tokens intact (usb-c recalls more than usb c)', () => {
    expect(normalizeSearchTerms('usb-c to hdmi adapter')).toEqual([
      'adapter',
      'hdmi',
      'usb-c',
    ])
  })

  it('collapses size units onto the bare number (names use 65", never "inch")', () => {
    expect(normalizeSearchTerms('65 inch tv')).toEqual(['65', 'tv'])
    expect(normalizeSearchTerms('65-inch tv')).toEqual(['65', 'tv'])
    expect(normalizeSearchTerms('65" tv')).toEqual(['65', 'tv'])
    expect(normalizeSearchTerms('65in tv')).toEqual(['65', 'tv'])
  })

  it('drops stopwords that only narrow name-AND recall', () => {
    // Measured: including "to" narrowed the adapter set 22 → 15.
    expect(normalizeSearchTerms('usb c to hdmi adapter')).not.toContain('to')
    expect(normalizeSearchTerms('case for the iphone')).toEqual([
      'case',
      'iphone',
    ])
  })

  it('does not mangle compound tokens like 4-in-1', () => {
    expect(normalizeSearchTerms('4-in-1 hub')).toEqual(['4-in-1', 'hub'])
  })

  it('returns empty for unusable input', () => {
    expect(normalizeSearchTerms('   ')).toEqual([])
    expect(normalizeSearchTerms('!@#$')).toEqual([])
    expect(normalizeSearchTerms('to the with')).toEqual([])
  })

  it('caps at 10 terms', () => {
    const terms = normalizeSearchTerms('q w e r t y u i o p l k j h g')
    expect(terms.length).toBe(10)
  })
})
