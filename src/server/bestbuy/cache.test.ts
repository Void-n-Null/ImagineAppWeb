import { describe, expect, it } from 'vitest'
import {
  buildCacheKey,
  resolveCacheNamespace,
  saleRolloverDateString,
  secondsUntilLocalMidnight,
} from './cache'

describe('resolveCacheNamespace', () => {
  it('shares one namespace between production and preview', () => {
    expect(resolveCacheNamespace('production')).toBe('bb:v4:')
    expect(resolveCacheNamespace('preview')).toBe('bb:v4:')
  })

  it('isolates development and local (undefined) environments', () => {
    expect(resolveCacheNamespace('development')).toBe('bb:dev:v4:')
    expect(resolveCacheNamespace(undefined)).toBe('bb:dev:v4:')
  })
})

describe('buildCacheKey', () => {
  it('sorts params so equivalent queries share a key', () => {
    const a = buildCacheKey('bb:v4:', '/products(sku=1)', {
      pageSize: '1',
      show: 'sku,name',
    })
    const b = buildCacheKey('bb:v4:', '/products(sku=1)', {
      show: 'sku,name',
      pageSize: '1',
    })
    expect(a).toBe(b)
    expect(a).toBe('bb:v4:/products(sku=1)?pageSize=1&show=sku,name')
  })

  it('omits the query separator when there are no params', () => {
    expect(buildCacheKey('bb:v4:', '/categories', {})).toBe('bb:v4:/categories')
  })
})

describe('secondsUntilLocalMidnight', () => {
  it('computes remaining seconds in the given zone', () => {
    // 23:00:00 UTC → 3600s to UTC midnight
    const now = new Date('2026-07-05T23:00:00Z')
    expect(secondsUntilLocalMidnight('UTC', now)).toBe(3600)
  })

  it('respects non-UTC zones', () => {
    // 03:30:10 UTC on Jul 5 = 22:30:10 Jul 4 in Chicago (CDT, UTC-5)
    const now = new Date('2026-07-05T03:30:10Z')
    expect(secondsUntilLocalMidnight('America/Chicago', now)).toBe(
      1 * 3600 + 29 * 60 + 50,
    )
  })

  it('never returns less than 60s so writes just before midnight still cache', () => {
    const now = new Date('2026-07-05T23:59:50Z')
    expect(secondsUntilLocalMidnight('UTC', now)).toBe(60)
  })

  it('returns a full day at exact midnight', () => {
    const now = new Date('2026-07-05T00:00:00Z')
    expect(secondsUntilLocalMidnight('UTC', now)).toBe(86_400)
  })
})

describe('saleRolloverDateString', () => {
  it('formats YYYY-MM-DD in the given zone', () => {
    const now = new Date('2026-07-05T12:00:00Z')
    expect(saleRolloverDateString('UTC', now)).toBe('2026-07-05')
  })

  it('reflects the zone-local date across the UTC day boundary', () => {
    // 02:00 UTC Jul 5 = 21:00 Jul 4 in Chicago (CDT).
    const now = new Date('2026-07-05T02:00:00Z')
    expect(saleRolloverDateString('America/Chicago', now)).toBe('2026-07-04')
  })
})
