import { describe, expect, it } from 'vitest'
import {
  buildExaRequestBody,
  buildWebCacheKey,
  normalizeWebQuery,
  parseExaResponse,
  resolveWebCacheNamespace,
  WEB_SEARCH_EXCERPT_CHARS,
} from './exa'

describe('resolveWebCacheNamespace', () => {
  it('shares production and preview', () => {
    expect(resolveWebCacheNamespace('production')).toBe('web:v1:')
    expect(resolveWebCacheNamespace('preview')).toBe('web:v1:')
  })

  it('isolates dev and tests', () => {
    expect(resolveWebCacheNamespace('development')).toBe('web:dev:v1:')
    expect(resolveWebCacheNamespace(undefined)).toBe('web:dev:v1:')
  })
})

describe('web cache keys', () => {
  it('normalizes whitespace and case so rephrasings share entries', () => {
    expect(normalizeWebQuery('  LG C4   HDMI 2.1 ')).toBe('lg c4 hdmi 2.1')
    expect(buildWebCacheKey('web:v1:', 'LG C4  bandwidth', 5)).toBe(
      buildWebCacheKey('web:v1:', 'lg c4 bandwidth', 5),
    )
  })

  it('separates entries by result count', () => {
    expect(buildWebCacheKey('web:v1:', 'q', 5)).not.toBe(
      buildWebCacheKey('web:v1:', 'q', 8),
    )
  })
})

describe('buildExaRequestBody', () => {
  it('requests auto type with capped text contents', () => {
    expect(buildExaRequestBody('soundbar reviews', 5)).toEqual({
      query: 'soundbar reviews',
      type: 'auto',
      numResults: 5,
      contents: { text: { maxCharacters: WEB_SEARCH_EXCERPT_CHARS } },
    })
  })
})

describe('parseExaResponse', () => {
  it('parses well-formed results', () => {
    const results = parseExaResponse({
      results: [
        {
          title: 'LG C4 OLED Review',
          url: 'https://www.rtings.com/tv/reviews/lg/c4-oled',
          publishedDate: '2026-03-14T00:00:00.000Z',
          text: 'Supports 4K @ 144Hz over HDMI 2.1.',
        },
      ],
    })
    expect(results).toHaveLength(1)
    expect(results[0]).toEqual({
      title: 'LG C4 OLED Review',
      url: 'https://www.rtings.com/tv/reviews/lg/c4-oled',
      publishedDate: '2026-03-14T00:00:00.000Z',
      text: 'Supports 4K @ 144Hz over HDMI 2.1.',
    })
  })

  it('drops results missing title or url, keeps the rest', () => {
    const results = parseExaResponse({
      results: [
        { title: '', url: 'https://a.example' },
        { title: 'No URL' },
        { title: 'Kept', url: 'https://b.example' },
        null,
      ],
    })
    expect(results.map((r) => r.title)).toEqual(['Kept'])
  })

  it('defaults absent optional fields instead of failing', () => {
    const [result] = parseExaResponse({
      results: [{ title: 'Bare', url: 'https://c.example' }],
    })
    expect(result.publishedDate).toBeNull()
    expect(result.text).toBe('')
  })

  it('throws on a response without a results array', () => {
    expect(() => parseExaResponse({})).toThrow(/results array/)
    expect(() => parseExaResponse(null)).toThrow(/JSON object/)
  })
})
