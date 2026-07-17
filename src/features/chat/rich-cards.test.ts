import { describe, expect, it } from 'vitest'
import {
  collectCardSkus,
  parseRichSegments,
  trimPartialRichToken,
} from './rich-cards'

describe('parseRichSegments', () => {
  it('passes plain markdown through untouched', () => {
    expect(parseRichSegments('Just **text**, no cards.')).toEqual([
      { kind: 'text', text: 'Just **text**, no cards.' },
    ])
  })

  it('extracts a product card between text', () => {
    expect(
      parseRichSegments('Here you go:\n\n[Product(8041012)]\n\nSolid pick.'),
    ).toEqual([
      { kind: 'text', text: 'Here you go:\n\n' },
      { kind: 'product', sku: 8041012 },
      { kind: 'text', text: '\n\nSolid pick.' },
    ])
  })

  it('handles multiple adjacent cards without empty text segments', () => {
    expect(parseRichSegments('[Product(1234567)] [Product(7654321)]')).toEqual([
      { kind: 'product', sku: 1234567 },
      { kind: 'product', sku: 7654321 },
    ])
  })

  it('parses compare tokens with 2-5 SKUs and tolerant spacing', () => {
    expect(parseRichSegments('[Compare(8041012, 8041013)]')).toEqual([
      { kind: 'compare', skus: [8041012, 8041013] },
    ])
  })

  it('rejects compare tokens outside 2-5 SKUs (kept as text)', () => {
    expect(parseRichSegments('[Compare(8041012)]')).toEqual([
      { kind: 'text', text: '[Compare(8041012)]' },
    ])
    expect(
      parseRichSegments('[Compare(1111,2222,3333,4444,5555,6666)]'),
    ).toEqual([
      { kind: 'text', text: '[Compare(1111,2222,3333,4444,5555,6666)]' },
    ])
  })

  it('dedupes repeated SKUs inside one compare token', () => {
    expect(parseRichSegments('[Compare(8041012,8041012,8041013)]')).toEqual([
      { kind: 'compare', skus: [8041012, 8041013] },
    ])
  })

  it('parses ShowSearch named query, ignoring v1 filter params', () => {
    expect(
      parseRichSegments(
        '[ShowSearch(query="gaming laptop", max_price=1500, sort_by="rating")]',
      ),
    ).toEqual([{ kind: 'search', query: 'gaming laptop' }])
  })

  it('parses bare ShowSearch content as the query', () => {
    expect(parseRichSegments('[ShowSearch(65 inch tv)]')).toEqual([
      { kind: 'search', query: '65 inch tv' },
    ])
  })

  it('keeps malformed tokens visible as plain text', () => {
    const malformed = 'See [Product(not-a-sku)] and [ShowSearch(on_sale=true)]'
    expect(parseRichSegments(malformed)).toEqual([
      { kind: 'text', text: malformed },
    ])
  })

  it('does not treat markdown links as tokens', () => {
    const text = 'Read [the review](https://rtings.com/x) first.'
    expect(parseRichSegments(text)).toEqual([{ kind: 'text', text }])
  })
})

describe('collectCardSkus', () => {
  it('gathers product and compare SKUs deduped in order', () => {
    const skus = collectCardSkus(
      parseRichSegments(
        '[Product(1111)] [Compare(2222,1111,3333)] [Product(2222)]',
      ),
    )
    expect(skus).toEqual([1111, 2222, 3333])
  })
})

describe('trimPartialRichToken (streaming draft)', () => {
  it('holds back a partial token mid-stream', () => {
    expect(trimPartialRichToken('Check this: [Product(80410')).toBe(
      'Check this: ',
    )
    expect(trimPartialRichToken('Options: [Compare(1234,')).toBe('Options: ')
    expect(trimPartialRichToken('Browse: [ShowSe')).toBe('Browse: ')
    expect(trimPartialRichToken('Or [')).toBe('Or ')
  })

  it('leaves completed tokens and ordinary text alone', () => {
    expect(trimPartialRichToken('Done: [Product(8041012)]')).toBe(
      'Done: [Product(8041012)]',
    )
    expect(trimPartialRichToken('No brackets at all')).toBe(
      'No brackets at all',
    )
  })

  it('leaves streaming markdown links alone', () => {
    expect(trimPartialRichToken('Read [the review](https://rt')).toBe(
      'Read [the review](https://rt',
    )
    expect(trimPartialRichToken('Read [the rev')).toBe('Read [the rev')
  })
})
