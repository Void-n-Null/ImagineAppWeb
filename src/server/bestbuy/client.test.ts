import { describe, expect, it } from 'vitest'
import type { CacheStore } from './cache'
import { BestBuyClient } from './client'
import { BestBuyHttpError } from './errors'

/**
 * In-memory CacheStore fake. Stores raw strings exactly as the client writes
 * them (envelope-wrapped JSON), so tests exercise the real read/decode path.
 */
class MemoryCache implements CacheStore {
  entries = new Map<string, { value: string; ttl: number }>()
  counters = new Map<string, number>()

  async get(key: string): Promise<string | null> {
    return this.entries.get(key)?.value ?? null
  }
  async getMany(keys: string[]): Promise<(string | null)[]> {
    if (keys.length === 0) return []
    return keys.map((k) => this.entries.get(k)?.value ?? null)
  }
  async set(key: string, value: string, ttl: number): Promise<void> {
    this.entries.set(key, { value, ttl })
  }
  async incr(key: string, _ttl: number): Promise<void> {
    this.counters.set(key, (this.counters.get(key) ?? 0) + 1)
  }
}

function product(overrides: Record<string, unknown> = {}) {
  return {
    sku: 42,
    name: 'Widget',
    salePrice: 9.99,
    onSale: false,
    upc: '111111111111',
    canonicalUrl: '/v1/products(sku=42)?apiKey=SECRET-KEY',
    ...overrides,
  }
}

function productsBody(products: Array<Record<string, unknown>>) {
  return JSON.stringify({
    total: products.length,
    currentPage: 1,
    totalPages: 1,
    canonicalUrl: '/v1/products(...)?apiKey=SECRET-KEY',
    products,
  })
}

const PRODUCT_BODY = productsBody([product()])

const RATE_LIMIT_BODY = JSON.stringify({
  errorCode: '403',
  errorMessage:
    'The provided API Key has reached the per second limit allotted to it.',
})

/** Fake fetch returning queued responses (repeats the last one when drained). */
function fetchQueue(...responses: Array<{ status: number; body: string }>) {
  const calls: string[] = []
  const queue = [...responses]
  const impl = (async (input: URL | RequestInfo) => {
    calls.push(String(input))
    const next = queue.length > 1 ? queue.shift() : queue[0]
    if (!next) throw new Error('fetchQueue drained')
    return new Response(next.body, { status: next.status })
  }) as typeof fetch
  return { impl, calls }
}

function makeClient(
  fetchImpl: typeof fetch,
  cache: CacheStore | null = null,
  extra: Partial<ConstructorParameters<typeof BestBuyClient>[0]> = {},
): BestBuyClient {
  return new BestBuyClient({
    apiKey: 'test-key',
    fetchImpl,
    cache,
    cacheNamespace: 'bb:test:v2:',
    retry: { attempts: 3, baseDelayMs: 1 },
    ...extra,
  })
}

describe('BestBuyClient caching', () => {
  it('serves the second identical lookup from the entity cache without fetching', async () => {
    const { impl, calls } = fetchQueue({ status: 200, body: PRODUCT_BODY })
    const cache = new MemoryCache()
    const client = makeClient(impl, cache)

    const first = await client.productBySku(42)
    const second = await client.productBySku(42)

    expect(first?.name).toBe('Widget')
    expect(second).toEqual(first)
    expect(calls.length).toBe(1)
  })

  it('caches the parsed DTO, never the raw body (which echoes the API key)', async () => {
    const { impl } = fetchQueue({ status: 200, body: PRODUCT_BODY })
    const cache = new MemoryCache()
    await makeClient(impl, cache).productBySku(42)

    const entityKey = 'bb:test:v2:product:42'
    const entry = cache.entries.get(entityKey)
    expect(entry).toBeDefined()
    expect(entry?.value).not.toContain('SECRET-KEY')
    expect(entry?.value).not.toContain('canonicalUrl')
    // Envelope + grace: logical TTL up to a day, Redis TTL adds 24h grace.
    expect(entry?.ttl).toBeGreaterThanOrEqual(60)
    expect(entry?.ttl).toBeLessThanOrEqual(86_400 + 24 * 3600)
  })

  it('caches empty results too — misses cost the same quota as hits', async () => {
    const { impl, calls } = fetchQueue({ status: 200, body: productsBody([]) })
    const cache = new MemoryCache()
    const client = makeClient(impl, cache)

    expect(await client.productByUpc('194253715375')).toBeNull()
    expect(await client.productByUpc('194253715375')).toBeNull()
    expect(calls.length).toBe(1)
  })

  it('treats a corrupt cache entry as a miss and refetches', async () => {
    const { impl, calls } = fetchQueue({ status: 200, body: PRODUCT_BODY })
    const cache = new MemoryCache()
    const client = makeClient(impl, cache)
    await client.productBySku(42)
    cache.entries.set('bb:test:v2:product:42', { value: '{not json', ttl: 100 })

    const again = await client.productBySku(42)
    expect(again?.name).toBe('Widget')
    expect(calls.length).toBe(2)
  })
})

describe('BestBuyClient entity priming', () => {
  it('primes entity + upc alias from a search so later lookups are free', async () => {
    const { impl, calls } = fetchQueue({
      status: 200,
      body: productsBody([product({ sku: 42, upc: '111111111111' })]),
    })
    const cache = new MemoryCache()
    const client = makeClient(impl, cache)

    // A search populates entity + alias keys.
    await client.products('search=widget', { sort: 'bestSellingRank.asc' })
    expect(cache.entries.has('bb:test:v2:product:42')).toBe(true)
    expect(cache.entries.has('bb:test:v2:upc:111111111111')).toBe(true)

    // Both point lookups now resolve from cache with ZERO further fetches.
    const bySku = await client.productBySku(42)
    const byUpc = await client.productByUpc('111111111111')
    expect(bySku?.sku).toBe(42)
    expect(byUpc?.sku).toBe(42)
    expect(calls.length).toBe(1)
  })

  it('productByUpc miss → fetch writes both keys; second call resolves via alias', async () => {
    const { impl, calls } = fetchQueue({
      status: 200,
      body: productsBody([product({ sku: 42, upc: '111111111111' })]),
    })
    const cache = new MemoryCache()
    const client = makeClient(impl, cache)

    const first = await client.productByUpc('111111111111')
    expect(first?.sku).toBe(42)
    expect(cache.entries.has('bb:test:v2:upc:111111111111')).toBe(true)
    expect(cache.entries.has('bb:test:v2:product:42')).toBe(true)

    const second = await client.productByUpc('111111111111')
    expect(second?.sku).toBe(42)
    expect(calls.length).toBe(1)
  })
})

describe('BestBuyClient batch lookups', () => {
  it('fetches only misses, in an in() filter, deduping/preserving results', async () => {
    const cache = new MemoryCache()
    // Pre-fetch skus 1 and 2 so they land in the entity cache.
    const seed = fetchQueue({
      status: 200,
      body: productsBody([
        product({ sku: 1, upc: '100000000001' }),
        product({ sku: 2, upc: '100000000002' }),
      ]),
    })
    await makeClient(seed.impl, cache).productsBySkus([1, 2])

    // Now request 1,2 (cached) + 3,4 (misses), with a duplicate to dedupe.
    const { impl, calls } = fetchQueue({
      status: 200,
      body: productsBody([
        product({ sku: 3, upc: '100000000003' }),
        product({ sku: 4, upc: '100000000004' }),
      ]),
    })
    const client = makeClient(impl, cache)
    const map = await client.productsBySkus([1, 2, 3, 4, 3])

    expect(calls.length).toBe(1)
    expect(calls[0]).toContain('sku%20in(3,4)') // "sku in(3,4)" (path commas)
    expect(calls[0]).not.toContain('in(1')
    expect(map.size).toBe(4)
    expect(map.get(1)?.sku).toBe(1)
    expect(map.get(4)?.sku).toBe(4)
  })

  it('chunks >chunkSize skus into multiple in() calls', async () => {
    const { impl, calls } = fetchQueue(
      { status: 200, body: productsBody([product({ sku: 10 })]) },
      { status: 200, body: productsBody([product({ sku: 20 })]) },
    )
    const client = makeClient(impl, new MemoryCache(), { batchChunkSize: 2 })
    await client.productsBySkus([10, 11, 20])
    // 3 misses, chunk size 2 → 2 fetch calls.
    expect(calls.length).toBe(2)
  })

  it('productsByUpcs resolves aliases then fetches only unknown upcs', async () => {
    const cache = new MemoryCache()
    const seed = fetchQueue({
      status: 200,
      body: productsBody([product({ sku: 7, upc: '100000000007' })]),
    })
    await makeClient(seed.impl, cache).productByUpc('100000000007')

    const { impl, calls } = fetchQueue({
      status: 200,
      body: productsBody([product({ sku: 8, upc: '100000000008' })]),
    })
    const client = makeClient(impl, cache)
    const map = await client.productsByUpcs(['100000000007', '100000000008'])

    expect(calls.length).toBe(1)
    expect(calls[0]).toContain('upc%20in(100000000008)')
    expect(calls[0]).not.toContain('100000000007')
    expect(map.get('100000000007')?.sku).toBe(7)
    expect(map.get('100000000008')?.sku).toBe(8)
  })
})

describe('BestBuyClient dedupe', () => {
  it('collapses concurrent identical requests into one fetch', async () => {
    const { impl, calls } = fetchQueue({ status: 200, body: PRODUCT_BODY })
    const client = makeClient(impl, new MemoryCache())

    const results = await Promise.all([
      client.productBySku(42),
      client.productBySku(42),
      client.productBySku(42),
    ])
    expect(results.every((r) => r?.sku === 42)).toBe(true)
    expect(calls.length).toBe(1)
  })
})

describe('BestBuyClient retry', () => {
  it('backs off and retries the per-second rate limit', async () => {
    const { impl, calls } = fetchQueue(
      { status: 403, body: RATE_LIMIT_BODY },
      { status: 200, body: PRODUCT_BODY },
    )
    const product = await makeClient(impl).productBySku(42)
    expect(product?.name).toBe('Widget')
    expect(calls.length).toBe(2)
  })

  it('retries 5xx but gives up after the attempt budget', async () => {
    const { impl, calls } = fetchQueue({ status: 503, body: 'unavailable' })
    await expect(makeClient(impl).productBySku(42)).rejects.toThrow(
      BestBuyHttpError,
    )
    expect(calls.length).toBe(3)
  })

  it('does not retry non-retryable client errors', async () => {
    const { impl, calls } = fetchQueue({
      status: 400,
      body: JSON.stringify({ error: { code: '400', message: 'bad query' } }),
    })
    await expect(makeClient(impl).productBySku(42)).rejects.toThrow('bad query')
    expect(calls.length).toBe(1)
  })

  it('scrubs the api key that Best Buy echoes in 400 messages (IMA-23)', async () => {
    // Realistic shape, measured live: BB's grammar errors quote the FULL
    // request URL, apiKey included.
    const { impl } = fetchQueue({
      status: 400,
      body: JSON.stringify({
        error: {
          code: '400',
          message:
            "Couldn't understand '/v1/products(modelNumber=X/1)?format=json&apiKey=SECRET-KEY': Failed at character 33.",
        },
      }),
    })
    const err = await makeClient(impl)
      .productBySku(42)
      .then(
        () => null,
        (e: unknown) => e as Error,
      )
    expect(err?.message).toContain('apiKey=REDACTED')
    expect(err?.message).not.toContain('SECRET-KEY')
  })
})

describe('BestBuyClient stale-if-error grace', () => {
  /** Force an entity envelope to be logically expired (past exp). */
  function expireEntity(cache: MemoryCache, key: string) {
    const entry = cache.entries.get(key)
    if (!entry) throw new Error(`no entry for ${key}`)
    const env = JSON.parse(entry.value) as { exp: number; data: unknown }
    env.exp = Math.floor(Date.now() / 1000) - 10
    cache.entries.set(key, { ...entry, value: JSON.stringify(env) })
  }

  it('refetches (fresh, not stale-flagged) when the envelope is expired but the API is healthy', async () => {
    const { impl, calls } = fetchQueue({ status: 200, body: PRODUCT_BODY })
    const cache = new MemoryCache()
    const client = makeClient(impl, cache)
    await client.productBySku(42)
    expireEntity(cache, 'bb:test:v2:product:42')

    const again = await client.productBySku(42)
    expect(again?.stale).toBeUndefined()
    expect(calls.length).toBe(2)
  })

  it('serves stale-flagged data when a refetch 503s through all retries', async () => {
    const cache = new MemoryCache()
    const seed = fetchQueue({ status: 200, body: PRODUCT_BODY })
    await makeClient(seed.impl, cache).productBySku(42)
    expireEntity(cache, 'bb:test:v2:product:42')

    const { impl } = fetchQueue({ status: 503, body: 'unavailable' })
    const client = makeClient(impl, cache)
    const result = await client.productBySku(42)
    expect(result?.name).toBe('Widget')
    expect(result?.stale).toBe(true)
  })

  it('still throws on a non-retryable error even with a stale entry present', async () => {
    const cache = new MemoryCache()
    const seed = fetchQueue({ status: 200, body: PRODUCT_BODY })
    await makeClient(seed.impl, cache).productBySku(42)
    expireEntity(cache, 'bb:test:v2:product:42')

    const { impl } = fetchQueue({
      status: 400,
      body: JSON.stringify({ error: { code: '400', message: 'bad query' } }),
    })
    await expect(makeClient(impl, cache).productBySku(42)).rejects.toThrow(
      'bad query',
    )
  })

  it('never grace-serves store availability (hard TTL, no envelope grace)', async () => {
    const { impl } = fetchQueue({
      status: 200,
      body: JSON.stringify({ ispuEligible: true, stores: [] }),
    })
    const cache = new MemoryCache()
    await makeClient(impl, cache).storeAvailability(42, { postalCode: '82001' })
    const [, entry] = [...cache.entries][0]
    // Redis TTL is exactly the logical TTL with no 24h grace added.
    expect(entry.ttl).toBe(600)
  })
})

describe('BestBuyClient store availability', () => {
  it('parses stores and uses a short TTL', async () => {
    const { impl } = fetchQueue({
      status: 200,
      body: JSON.stringify({
        ispuEligible: true,
        stores: [
          {
            storeID: 123,
            longName: 'Best Buy - Example',
            city: 'Cheyenne',
            region: 'WY',
            distance: 2.1,
            lowStock: true,
          },
        ],
      }),
    })
    const cache = new MemoryCache()
    const page = await makeClient(impl, cache).storeAvailability(42, {
      postalCode: '82001',
    })
    expect(page.ispuEligible).toBe(true)
    expect(page.stores[0]).toMatchObject({
      storeId: 123,
      name: 'Best Buy - Example',
      state: 'WY',
      lowStock: true,
    })
    const entry = [...cache.entries.values()][0]
    expect(entry.ttl).toBe(600)
  })

  it('maps 404 to an empty availability page', async () => {
    const { impl } = fetchQueue({
      status: 404,
      body: JSON.stringify({ error: { code: '404', message: 'not found' } }),
    })
    const page = await makeClient(impl).storeAvailability(42, {
      postalCode: '82001',
    })
    expect(page).toEqual({ ispuEligible: false, stores: [] })
  })

  it('normalizes postal codes in the URL + cache key', async () => {
    const postal = fetchQueue({
      status: 200,
      body: JSON.stringify({ ispuEligible: true, stores: [] }),
    })
    const postalCache = new MemoryCache()
    await makeClient(postal.impl, postalCache).storeAvailability(42, {
      postalCode: ' n9a 6j3 ',
    })
    expect(postal.calls[0]).toContain('postalCode=N9A6J3')
    expect([...postalCache.entries.keys()][0]).toContain('postalCode=N9A6J3')
  })
})

describe('BestBuyClient telemetry', () => {
  it('counts every physical call (retries included) and cache hits', async () => {
    const { impl } = fetchQueue(
      { status: 503, body: 'unavailable' },
      { status: 200, body: PRODUCT_BODY },
    )
    const cache = new MemoryCache()
    const client = makeClient(impl, cache)

    // One retry + one success = 2 physical calls, 0 hits.
    await client.productBySku(42)
    const callKey = [...cache.counters.keys()].find((k) => k.endsWith(':calls'))
    expect(callKey).toBeDefined()
    expect(callKey).toContain('bb:test:v2:quota:')
    expect(cache.counters.get(callKey as string)).toBe(2)

    // Second lookup is a fresh cache hit → increments hits, not calls.
    await client.productBySku(42)
    const hitKey = [...cache.counters.keys()].find((k) => k.endsWith(':hits'))
    expect(hitKey).toBeDefined()
    expect(cache.counters.get(hitKey as string)).toBe(1)
    expect(cache.counters.get(callKey as string)).toBe(2)
  })
})
