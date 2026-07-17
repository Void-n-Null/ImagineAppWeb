import { describe, expect, it } from 'vitest'
import { decodeHtmlEntities, parseProduct, parseProductsPage } from './types'

describe('decodeHtmlEntities', () => {
  it('decodes numeric entities (the &#8217; apostrophes BB ships)', () => {
    expect(decodeHtmlEntities('what&#8217;s next')).toBe('what’s next')
    expect(decodeHtmlEntities('subwoofer.&#185;')).toBe('subwoofer.¹')
  })

  it('decodes hex entities', () => {
    expect(decodeHtmlEntities('4K&#x2122;')).toBe('4K™')
  })

  it('decodes common named entities', () => {
    expect(decodeHtmlEntities('Insignia&trade; &amp; Rocketfish&reg;')).toBe(
      'Insignia™ & Rocketfish®',
    )
  })

  it('leaves unknown entities and bare ampersands alone', () => {
    expect(decodeHtmlEntities('Black & Decker &bogus123;')).toBe(
      'Black & Decker &bogus123;',
    )
  })

  it('is idempotent on already-clean text', () => {
    const clean = 'Dolby Atmos — 5.1.2 channels'
    expect(decodeHtmlEntities(clean)).toBe(clean)
  })
})

describe('parseProduct entity decoding + new fields', () => {
  const raw = {
    sku: 123,
    name: 'Soundbar &#8212; Black',
    features: [{ feature: 'Feel the rumble&#185;' }],
    shortDescription: 'It&#8217;s loud',
    weight: '6 pounds',
    height: '2.3 inches',
    width: '40.6 inches',
    depth: '4.1 inches',
    warrantyLabor: '1 year',
    warrantyParts: 'Limited lifetime',
  }

  it('decodes prose fields and keeps identifiers verbatim', () => {
    const product = parseProduct(raw)
    expect(product.name).toBe('Soundbar — Black')
    expect(product.features).toEqual(['Feel the rumble¹'])
    expect(product.shortDescription).toBe('It’s loud')
  })

  it('carries the IMA-10 physical/warranty fields', () => {
    const product = parseProduct(raw)
    expect(product.weight).toBe('6 pounds')
    expect(product.width).toBe('40.6 inches')
    expect(product.warrantyParts).toBe('Limited lifetime')
  })

  it('parses the IMA-29 details spec sheet, dropping half-empty rows', () => {
    const product = parseProduct({
      ...raw,
      details: [
        { name: 'Number of HDMI Inputs', value: '2' },
        { name: 'Voice Assistant&#8482;', value: 'Alexa &amp; Google' },
        { name: 'Orphaned name' },
        { value: 'orphaned value' },
        'garbage',
      ],
    })
    expect(product.details).toEqual([
      { name: 'Number of HDMI Inputs', value: '2' },
      { name: 'Voice Assistant™', value: 'Alexa & Google' },
    ])
  })

  it('defaults details to empty when absent (pre-v4 shapes)', () => {
    expect(parseProduct(raw).details).toEqual([])
  })
})

describe('parseProductsPage facets', () => {
  it('parses the flat facet rollup shape (measured 2026-07-06)', () => {
    const page = parseProductsPage({
      total: 164,
      currentPage: 1,
      totalPages: 164,
      products: [],
      facets: { manufacturer: { samsung: 25, lg: 14, 'insignia™': 7 } },
    })
    expect(page.facets).toEqual({
      manufacturer: { samsung: 25, lg: 14, 'insignia™': 7 },
    })
  })

  it('omits facets when absent or malformed', () => {
    expect(parseProductsPage({ products: [] }).facets).toBeUndefined()
    expect(
      parseProductsPage({ products: [], facets: 'garbage' }).facets,
    ).toBeUndefined()
  })
})
