import { describe, expect, it } from 'vitest'
import { ProductSearchBuilder } from '#/server/bestbuy/search-builder'

/**
 * The keyword pipeline itself is covered in search-terms.test.ts and
 * search-builder.test.ts; this locks the server function's composed recipe
 * (the exact filter the search bar sends) so drift is visible in review.
 *
 * Note the recipe deliberately has NO inStoreAvailability filter: "Sold in
 * stores" is a client-side view filter so both toggle states share one
 * cache entry per page (see search-products.ts).
 */
describe('search bar recipe', () => {
  function recipe(query: string) {
    return new ProductSearchBuilder()
      .keywords(query)
      .excludeFloorNoise()
      .newOnly()
      .page(1)
      .pageSize(20)
      .build()
  }

  it('produces the measured universal recipe for a floor query', () => {
    const { filter, params } = recipe('65 inch tv')
    expect(filter).toBe(
      'search=65&search=tv' +
        '&type!=BlackTie' +
        '&categoryPath.id!=cat09000' +
        '&categoryPath.id!=pcmcat1528819595254' +
        '&condition=new',
    )
    expect(params.sort).toBe('customerReviewCount.dsc')
    expect(params.pageSize).toBe('20')
  })

  it('never filters on in-store availability (client-side view filter)', () => {
    expect(recipe('65 inch tv').filter).not.toContain('inStoreAvailability')
  })

  it('equivalent queries share one cache entry (identical filter)', () => {
    expect(recipe('M4 MacBook Air').filter).toBe(
      recipe('air macbook m4').filter,
    )
  })
})
