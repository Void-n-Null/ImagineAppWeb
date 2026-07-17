import { describe, expect, it } from 'vitest'
import { BestBuyError } from './errors'
import { DEFAULT_SORT, ProductSearchBuilder } from './search-builder'

describe('ProductSearchBuilder', () => {
  it('builds the measured universal recipe', () => {
    const { filter, params } = new ProductSearchBuilder()
      .keywords('macbook air')
      .excludeFloorNoise()
      .newOnly()
      .availableInStore()
      .build()

    expect(filter).toBe(
      'search=air&search=macbook' +
        '&type!=BlackTie' +
        '&categoryPath.id!=cat09000' +
        '&categoryPath.id!=pcmcat1528819595254' +
        '&condition=new' +
        '&inStoreAvailability=true',
    )
    expect(params).toEqual({
      page: '1',
      pageSize: '10',
      sort: DEFAULT_SORT,
    })
  })

  it('always sets an explicit sort (alphabetized-terms cache contract)', () => {
    const { params } = new ProductSearchBuilder().keywords('tv').build()
    expect(params.sort).toBe('customerReviewCount.dsc')
  })

  it('quotes model numbers (unquoted slash is a measured 400)', () => {
    const { filter } = new ProductSearchBuilder()
      .byModelNumber('Z1H81LL/A')
      .build()
    expect(filter).toBe('modelNumber="Z1H81LL/A"')
  })

  it('strips embedded quotes rather than letting values escape the grammar', () => {
    const { filter } = new ProductSearchBuilder()
      .byManufacturer('Bose" OR sku=1 OR "')
      .build()
    expect(filter).toBe('manufacturer="Bose OR sku=1 OR"')
  })

  it('quotes manufacturer lists', () => {
    const { filter } = new ProductSearchBuilder()
      .byManufacturers(['Samsung', 'Best Buy essentials™'])
      .build()
    expect(filter).toBe('manufacturer in("Samsung","Best Buy essentials™")')
  })

  it('builds vertical screen-size ranges', () => {
    const { filter } = new ProductSearchBuilder()
      .inCategory('abcat0101000')
      .screenSizeBetween(63, 67)
      .build()
    expect(filter).toBe(
      'categoryPath.id=abcat0101000&screenSizeIn>=63&screenSizeIn<=67',
    )
  })

  it('supports facets', () => {
    const { params } = new ProductSearchBuilder()
      .inCategory('abcat0101000')
      .facet('manufacturer', 8)
      .build()
    expect(params.facet).toBe('manufacturer,8')
  })

  it('rejects malformed identifiers instead of emitting broken grammar', () => {
    const builder = new ProductSearchBuilder()
    expect(() => builder.bySku(-1)).toThrow(BestBuyError)
    expect(() => builder.byUpc('abc')).toThrow(BestBuyError)
    expect(() => builder.inCategory('cat09000)&sku=1')).toThrow(BestBuyError)
    expect(() => builder.releasedAfter('yesterday')).toThrow(BestBuyError)
    expect(() => builder.facet('manufacturer,8&x', 8)).toThrow(BestBuyError)
  })

  it('clamps pagination to API limits', () => {
    const { params } = new ProductSearchBuilder()
      .keywords('tv')
      .page(5000)
      .pageSize(999)
      .build()
    expect(params.page).toBe('1000')
    expect(params.pageSize).toBe('100')
  })

  it('refuses to build an unfiltered query', () => {
    expect(() => new ProductSearchBuilder().build()).toThrow(BestBuyError)
    // Stopword-only input normalizes to zero terms → still unfiltered.
    expect(() => new ProductSearchBuilder().keywords('to the').build()).toThrow(
      BestBuyError,
    )
  })

  it('exposes searchTermCount so callers can bail before querying', () => {
    expect(new ProductSearchBuilder().keywords('   ').searchTermCount).toBe(0)
    expect(new ProductSearchBuilder().keywords('tv').searchTermCount).toBe(1)
  })
})
