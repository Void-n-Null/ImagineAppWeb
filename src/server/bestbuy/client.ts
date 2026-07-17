import process from 'node:process'
import {
  buildCacheKey,
  type CacheStore,
  createCacheFromEnv,
  resolveCacheNamespace,
  SALE_ROLLOVER_TIMEZONE,
  saleRolloverDateString,
  secondsUntilLocalMidnight,
} from './cache'
import {
  BestBuyError,
  BestBuyHttpError,
  BestBuyNetworkError,
  BestBuyParseError,
} from './errors'
import { SingleFlight } from './single-flight'
import {
  type BestBuyCategory,
  type BestBuyProduct,
  type CategoriesPage,
  PRODUCT_ATTRIBUTES,
  type ProductsPage,
  parseCategoriesPage,
  parseProductsPage,
  parseStoreAvailabilityPage,
  type StoreAvailabilityPage,
} from './types'

/**
 * Server-only Best Buy API client (products, categories, store availability).
 *
 * Port of v1's BestBuyClient (lib/services/bestbuy/bestbuy_client.dart) plus
 * everything v1 defined but never delivered, now with the schema-v2
 * optimizations (IMA-3 + cache optimization pass):
 * - shared Upstash cache, TTL to Best Buy's national sale rollover (midnight
 *   Central; see SALE_ROLLOVER_TIMEZONE) — one lookup/day serves every user,
 *   neutralizing the 50k/day key quota
 * - entity-keyed product cache + upc alias, primed from EVERY response, so any
 *   product seen anywhere becomes a free lookup for the rest of the day
 * - batch lookups that check the cache in bulk (mget) and fetch only misses in
 *   `sku in(...)` / `upc in(...)` chunks of ≤100 per call
 * - envelope wrapping with stale-if-error grace: a logically-expired entry can
 *   still be served (flagged) when a refresh fails transiently
 * - real rate-limit backoff and single-flight dedupe of concurrent identical
 *   requests (per instance; cross-instance duplicates hit the shared cache)
 *
 * The raw response body (whose `canonicalUrl` echoes the API key) never leaves
 * this module — only parsed, schema-versioned DTOs are cached.
 */

const DEFAULT_BASE_URL = 'https://api.bestbuy.com/v1'
const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_RETRY_ATTEMPTS = 3
const DEFAULT_RETRY_BASE_DELAY_MS = 400
/** In-store stock moves intraday — much shorter TTL than catalog data. */
const STORE_AVAILABILITY_TTL_SECONDS = 600
/**
 * Extra Redis TTL beyond the logical (envelope) expiry, so a logically-expired
 * catalog entry lingers as a stale-if-error fallback. Store availability opts
 * out of this grace (stock is too volatile to serve stale).
 */
const STALE_GRACE_SECONDS = 24 * 3600
/** Quota counters outlive their day so a late read still finds them. */
const QUOTA_TTL_SECONDS = 48 * 3600
/** Max items per `in(...)` batch call (Best Buy pageSize cap). */
const BATCH_CHUNK_SIZE = 100

/** Envelope wrapping every cached DTO: logical expiry + payload. */
interface CacheEnvelope<T> {
  /** Epoch seconds at which the payload becomes logically stale. */
  exp: number
  data: T
}

export interface BestBuyRetryOptions {
  /** Total attempts including the first (default 3). */
  attempts?: number
  /** First backoff delay; grows 3x per retry with jitter (default 400ms). */
  baseDelayMs?: number
}

export interface BestBuyClientOptions {
  apiKey: string
  baseUrl?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
  /** Response cache; omit/null to disable caching (e.g. unit tests, CI). */
  cache?: CacheStore | null
  /** Key prefix, e.g. `bb:v2:`. Defaults from VERCEL_ENV. */
  cacheNamespace?: string
  /**
   * IANA zone whose midnight expires catalog entries — Best Buy's national
   * daily-deal rollover clock, not a user/store assumption. Central Time.
   */
  saleRolloverTimeZone?: string
  retry?: BestBuyRetryOptions
  /** Test seam: override the `in(...)` batch chunk size. */
  batchChunkSize?: number
}

export class BestBuyClient {
  readonly #apiKey: string
  readonly #baseUrl: string
  readonly #timeoutMs: number
  readonly #fetch: typeof fetch
  readonly #cache: CacheStore | null
  readonly #cacheNamespace: string
  readonly #saleRolloverTimeZone: string
  readonly #retryAttempts: number
  readonly #retryBaseDelayMs: number
  readonly #batchChunkSize: number
  readonly #singleFlight = new SingleFlight()

  constructor(options: BestBuyClientOptions) {
    if (!options.apiKey) {
      throw new BestBuyError('BestBuyClient requires an API key')
    }
    this.#apiKey = options.apiKey
    this.#baseUrl = options.baseUrl ?? DEFAULT_BASE_URL
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.#fetch = options.fetchImpl ?? fetch
    this.#cache = options.cache ?? null
    this.#cacheNamespace = options.cacheNamespace ?? resolveCacheNamespace()
    this.#saleRolloverTimeZone =
      options.saleRolloverTimeZone ?? SALE_ROLLOVER_TIMEZONE
    this.#retryAttempts = Math.max(
      1,
      options.retry?.attempts ?? DEFAULT_RETRY_ATTEMPTS,
    )
    this.#retryBaseDelayMs =
      options.retry?.baseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS
    this.#batchChunkSize = Math.max(
      1,
      options.batchChunkSize ?? BATCH_CHUNK_SIZE,
    )
  }

  // ─────────────────────────────── Products ───────────────────────────────

  /**
   * Look up a single product by store SKU. Null when not in the catalog.
   *
   * Entity-cached under `product:<sku>`: a hit (fresh or a priming leftover
   * from any earlier response) returns with zero fetches. A miss fetches
   * `sku=<sku>`, primes the entity + upc alias, and returns.
   */
  async productBySku(sku: number): Promise<BestBuyProduct | null> {
    if (!Number.isSafeInteger(sku) || sku <= 0) {
      throw new BestBuyError(`Invalid SKU: ${sku}`)
    }
    const key = this.#productKey(sku)
    return this.#singleFlight.run(key, async () => {
      const cached = await this.#readEntity(key)
      if (cached.value !== undefined && !cached.stale) return cached.value
      try {
        const page = await this.#fetchProductsUncached(`sku=${sku}`, {
          pageSize: '1',
        })
        return page.products[0] ?? null
      } catch (err) {
        // Stale-if-error: a transient failure can serve the expired entity.
        if (cached.value != null && isRetryable(err)) {
          return { ...cached.value, stale: true as const }
        }
        throw err
      }
    })
  }

  /**
   * Look up a single product by UPC (from a barcode). Null when unknown.
   *
   * Two-hop cache: `upc:<upc>` alias → sku → `product:<sku>` entity. A miss on
   * either hop fetches `upc=<upc>` and primes both keys.
   */
  async productByUpc(upc: string): Promise<BestBuyProduct | null> {
    if (!/^\d{6,14}$/.test(upc)) {
      throw new BestBuyError(`Invalid UPC: ${upc}`)
    }
    const aliasKey = this.#upcKey(upc)
    return this.#singleFlight.run(aliasKey, async () => {
      const alias = await this.#readAlias(aliasKey)
      if (alias.value !== undefined && !alias.stale) {
        // Alias resolved to a sku (or an explicit null "no such product").
        if (alias.value === null) return null
        const entity = await this.#readEntity(this.#productKey(alias.value))
        if (entity.value !== undefined && !entity.stale) return entity.value
      }
      try {
        const page = await this.#fetchProductsUncached(`upc=${upc}`, {
          pageSize: '1',
        })
        const product = page.products[0] ?? null
        // Record a negative alias so repeat unknown-UPC scans stay free.
        if (product === null) {
          await this.#primeUpcAlias(upc, null)
        }
        return product
      } catch (err) {
        if (
          alias.value !== undefined &&
          alias.value !== null &&
          isRetryable(err)
        ) {
          const entity = await this.#readEntity(this.#productKey(alias.value))
          if (entity.value != null) {
            return { ...entity.value, stale: true as const }
          }
        }
        throw err
      }
    })
  }

  /**
   * Batch SKU lookup. Returns a Map keyed by the requested SKU (present only
   * for SKUs that exist in the catalog). Input is deduped/validated; entity
   * keys are bulk-checked (mget) and only misses are fetched, in `sku in(...)`
   * chunks of ≤100 per call. Every fetched product primes its entity + alias.
   */
  async productsBySkus(skus: number[]): Promise<Map<number, BestBuyProduct>> {
    const unique = dedupePositiveInts(skus)
    const result = new Map<number, BestBuyProduct>()
    if (unique.length === 0) return result

    const keys = unique.map((sku) => this.#productKey(sku))
    const cached = (await this.#cache?.getMany(keys)) ?? keys.map(() => null)
    const misses: number[] = []
    for (let i = 0; i < unique.length; i++) {
      const env = decodeEnvelope<BestBuyProduct>(cached[i])
      if (env && env.exp > nowSeconds()) {
        this.#recordHit()
        result.set(unique[i], env.data)
      } else {
        misses.push(unique[i])
      }
    }

    for (const chunk of chunkArray(misses, this.#batchChunkSize)) {
      const filter = `sku in(${chunk.join(',')})`
      const page = await this.#fetchProductsUncached(filter, {
        pageSize: String(this.#batchChunkSize),
      })
      for (const product of page.products) result.set(product.sku, product)
    }
    return result
  }

  /**
   * Batch UPC lookup. Returns a Map keyed by the requested UPC (present only
   * for UPCs that exist). Aliases are bulk-checked first, then their entities;
   * remaining misses fetch `upc in(...)` in ≤100 chunks and prime both keys.
   */
  async productsByUpcs(upcs: string[]): Promise<Map<string, BestBuyProduct>> {
    const unique = dedupeUpcs(upcs)
    const result = new Map<string, BestBuyProduct>()
    if (unique.length === 0) return result

    // Hop 1: aliases → sku numbers.
    const aliasKeys = unique.map((upc) => this.#upcKey(upc))
    const aliasRaw =
      (await this.#cache?.getMany(aliasKeys)) ?? aliasKeys.map(() => null)
    const resolvedSku = new Map<string, number>()
    const upcMisses: string[] = []
    for (let i = 0; i < unique.length; i++) {
      const env = decodeEnvelope<number | null>(aliasRaw[i])
      if (env && env.exp > nowSeconds() && typeof env.data === 'number') {
        resolvedSku.set(unique[i], env.data)
      } else {
        upcMisses.push(unique[i])
      }
    }

    // Hop 2: resolved skus → entities.
    const resolvedEntries = [...resolvedSku.entries()]
    if (resolvedEntries.length > 0) {
      const entityKeys = resolvedEntries.map(([, sku]) => this.#productKey(sku))
      const entityRaw =
        (await this.#cache?.getMany(entityKeys)) ?? entityKeys.map(() => null)
      for (let i = 0; i < resolvedEntries.length; i++) {
        const [upc] = resolvedEntries[i]
        const env = decodeEnvelope<BestBuyProduct>(entityRaw[i])
        if (env && env.exp > nowSeconds()) {
          this.#recordHit()
          result.set(upc, env.data)
        } else {
          upcMisses.push(upc)
        }
      }
    }

    for (const chunk of chunkArray(upcMisses, this.#batchChunkSize)) {
      const filter = `upc in(${chunk.join(',')})`
      const page = await this.#fetchProductsUncached(filter, {
        pageSize: String(this.#batchChunkSize),
      })
      // Fetched products are primed by upc alias; map results back by upc.
      const byUpc = new Map<string, BestBuyProduct>()
      for (const product of page.products) {
        if (product.upc !== null) byUpc.set(product.upc, product)
      }
      for (const upc of chunk) {
        const product = byUpc.get(upc)
        if (product) result.set(upc, product)
      }
    }
    return result
  }

  /**
   * Run a products query. `filter` is the parenthesized expression in
   * `/products(<filter>)`; callers own its syntax (IMA-4's search builder),
   * which is why the fixed lookups above validate their inputs strictly.
   *
   * Query-shaped result cached under the v2 namespace (with envelope grace);
   * every contained product is also primed into its entity + upc alias.
   */
  async products(
    filter: string,
    params: Record<string, string> = {},
  ): Promise<ProductsPage> {
    const page = await this.#cached(
      `/products(${filter})`,
      { show: PRODUCT_ATTRIBUTES.join(','), ...params },
      () => secondsUntilLocalMidnight(this.#saleRolloverTimeZone),
      STALE_GRACE_SECONDS,
      parseProductsPage,
    )
    await this.#primeProducts(page.products)
    return page
  }

  /**
   * Direct products fetch used by the entity-keyed single/batch lookups. The
   * entity + upc alias keys ARE the cache for those paths, so this deliberately
   * does NOT write a query-shaped envelope (that would double-cache and let a
   * corrupt/expired entity be masked by a stale query key). It still primes
   * every returned product into its entity + alias keys.
   */
  async #fetchProductsUncached(
    filter: string,
    params: Record<string, string>,
  ): Promise<ProductsPage> {
    const raw = await this.#request(`/products(${filter})`, {
      show: PRODUCT_ATTRIBUTES.join(','),
      ...params,
    })
    const page = parseProductsPage(raw)
    await this.#primeProducts(page.products)
    return page
  }

  // ─────────────────────────────── Categories ─────────────────────────────

  /** Page through the category tree (all top-level when no filter). */
  async categories(
    filter: string | null = null,
    params: Record<string, string> = {},
  ): Promise<CategoriesPage> {
    const path = filter === null ? '/categories' : `/categories(${filter})`
    return this.#cached(
      path,
      { pageSize: '100', ...params },
      () => secondsUntilLocalMidnight(this.#saleRolloverTimeZone),
      STALE_GRACE_SECONDS,
      parseCategoriesPage,
    )
  }

  /** Fetch one category (with subcategory refs). Null when unknown. */
  async categoryById(categoryId: string): Promise<BestBuyCategory | null> {
    if (!/^[a-zA-Z0-9]+$/.test(categoryId)) {
      throw new BestBuyError(`Invalid category id: ${categoryId}`)
    }
    try {
      const page = await this.categories(`id=${categoryId}`, { pageSize: '1' })
      return page.categories[0] ?? null
    } catch (err) {
      if (err instanceof BestBuyHttpError && err.isNotFound) return null
      throw err
    }
  }

  // ─────────────────────────── Store availability ─────────────────────────

  /**
   * In-store pickup availability near a postal code
   * (`/products/{sku}/stores.json`). Cached briefly with NO stale grace — stock
   * is intraday data, too volatile to ever serve stale.
   *
   * Postal codes normalize (trim, uppercase, no internal spaces — Canadian
   * "N9A 6J3" → "N9A6J3") before reaching the cache key, so everyone near the
   * same zip shares one entry. No home/default location is ever assumed.
   *
   * NOTE: v1 also had a lat/lng variant (getStoreAvailabilityByLocation,
   * bestbuy_client.dart:284). Verified live 2026-07-05: the endpoint rejects
   * lat/lng with 400 "Missing required query parameter 'storeId' or
   * 'postalCode'" — v1's location variant was silently broken. Geolocation
   * support means reverse-geocoding to a postal code client-side first.
   */
  async storeAvailability(
    sku: number,
    near: { postalCode: string },
  ): Promise<StoreAvailabilityPage> {
    if (!Number.isSafeInteger(sku) || sku <= 0) {
      throw new BestBuyError(`Invalid SKU: ${sku}`)
    }
    const params: Record<string, string> = {
      postalCode: normalizePostalCode(near.postalCode),
    }
    try {
      return await this.#cached(
        `/products/${sku}/stores.json`,
        params,
        () => STORE_AVAILABILITY_TTL_SECONDS,
        0, // No grace: hard 600s Redis TTL, envelope exp = same.
        parseStoreAvailabilityPage,
      )
    } catch (err) {
      if (err instanceof BestBuyHttpError && err.isNotFound) {
        return { ispuEligible: false, stores: [] }
      }
      throw err
    }
  }

  // ──────────────────────── Cache + dedupe + retry core ───────────────────

  /**
   * cache lookup → API fetch → parse → cache write, the whole pipeline
   * single-flighted per normalized key so concurrent identical calls share
   * one execution. Values are envelope-wrapped: `now < exp` is a fresh hit;
   * a present-but-expired envelope is treated as a miss, but is served (flagged
   * `stale`) if the refresh fails with a retryable-class error and `grace > 0`.
   */
  async #cached<T extends { stale?: true }>(
    path: string,
    params: Record<string, string>,
    ttlSeconds: () => number,
    graceSeconds: number,
    parse: (raw: unknown) => T,
  ): Promise<T> {
    const key = buildCacheKey(this.#cacheNamespace, path, params)
    return this.#singleFlight.run(key, async () => {
      const hit = await this.#cache?.get(key)
      const envelope = decodeEnvelope<T>(hit)
      if (envelope && envelope.exp > nowSeconds()) {
        this.#recordHit()
        return envelope.data
      }

      let value: T
      try {
        const raw = await this.#request(path, params)
        value = parse(raw)
      } catch (err) {
        // Stale-if-error: a logically-expired entry survives a transient fail.
        if (envelope && graceSeconds > 0 && isRetryable(err)) {
          return { ...envelope.data, stale: true as const }
        }
        throw err
      }

      const ttl = ttlSeconds()
      await this.#writeEnvelope(key, value, ttl, graceSeconds)
      return value
    })
  }

  /** Request with backoff on retryable failures (rate limit, 5xx, network). */
  async #request(
    path: string,
    params: Record<string, string>,
  ): Promise<unknown> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.#requestOnce(path, params)
      } catch (err) {
        if (attempt >= this.#retryAttempts || !isRetryable(err)) throw err
        const backoff = this.#retryBaseDelayMs * 3 ** (attempt - 1)
        const jitter = Math.random() * this.#retryBaseDelayMs
        await sleep(backoff + jitter)
      }
    }
  }

  async #requestOnce(
    path: string,
    params: Record<string, string>,
  ): Promise<unknown> {
    const url = new URL(`${this.#baseUrl}${path}`)
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value)
    }
    url.searchParams.set('format', 'json')
    url.searchParams.set('apiKey', this.#apiKey)

    // Telemetry: count every physical HTTP attempt (retries included).
    this.#recordCall()

    let response: Response
    try {
      response = await this.#fetch(url, {
        signal: AbortSignal.timeout(this.#timeoutMs),
      })
    } catch (cause) {
      const isTimeout =
        cause instanceof DOMException && cause.name === 'TimeoutError'
      throw new BestBuyNetworkError(
        isTimeout
          ? `Best Buy request timed out after ${this.#timeoutMs}ms`
          : 'Best Buy request failed before a response arrived',
        { cause, isTimeout },
      )
    }

    const body = await response.text()
    if (!response.ok) {
      throw toHttpError(response.status, body)
    }

    try {
      return JSON.parse(body)
    } catch (cause) {
      throw new BestBuyParseError('Best Buy returned unparseable JSON', {
        cause,
      })
    }
  }

  // ─────────────────────────── Entity cache + priming ──────────────────────

  #productKey(sku: number): string {
    return `${this.#cacheNamespace}product:${sku}`
  }

  #upcKey(upc: string): string {
    return `${this.#cacheNamespace}upc:${upc}`
  }

  /** Read + decode an entity key. `value: undefined` = miss/corrupt. */
  async #readEntity(
    key: string,
  ): Promise<{ value?: BestBuyProduct; stale: boolean }> {
    const raw = await this.#cache?.get(key)
    const env = decodeEnvelope<BestBuyProduct>(raw)
    if (!env) return { stale: false }
    const stale = env.exp <= nowSeconds()
    if (!stale) this.#recordHit()
    return { value: env.data, stale }
  }

  /** Read + decode a upc alias key. Alias data is a sku number or null. */
  async #readAlias(
    key: string,
  ): Promise<{ value?: number | null; stale: boolean }> {
    const raw = await this.#cache?.get(key)
    const env = decodeEnvelope<number | null>(raw)
    if (!env) return { stale: false }
    const stale = env.exp <= nowSeconds()
    // Alias resolution is only a "hit" when it points at a real sku.
    if (!stale && typeof env.data === 'number') this.#recordHit()
    return { value: env.data, stale }
  }

  /**
   * Prime every product into its entity key + upc alias (best-effort). This is
   * the core optimization: any product seen in any response becomes a free
   * same-day lookup. Skips products whose upc is null for the alias write.
   */
  async #primeProducts(products: BestBuyProduct[]): Promise<void> {
    if (!this.#cache || products.length === 0) return
    const ttl = secondsUntilLocalMidnight(this.#saleRolloverTimeZone)
    await Promise.all(
      products.flatMap((product) => {
        const writes = [
          this.#writeEnvelope(
            this.#productKey(product.sku),
            product,
            ttl,
            STALE_GRACE_SECONDS,
          ),
        ]
        if (product.upc !== null) {
          writes.push(
            this.#writeEnvelope(
              this.#upcKey(product.upc),
              product.sku,
              ttl,
              STALE_GRACE_SECONDS,
            ),
          )
        }
        return writes
      }),
    )
  }

  /** Write a negative (or positive) upc alias only. */
  async #primeUpcAlias(upc: string, sku: number | null): Promise<void> {
    const ttl = secondsUntilLocalMidnight(this.#saleRolloverTimeZone)
    await this.#writeEnvelope(this.#upcKey(upc), sku, ttl, STALE_GRACE_SECONDS)
  }

  /** Envelope-wrap a value and write with logical TTL + optional grace. */
  async #writeEnvelope(
    key: string,
    data: unknown,
    ttlSeconds: number,
    graceSeconds: number,
  ): Promise<void> {
    if (!this.#cache) return
    const exp = nowSeconds() + Math.max(1, Math.floor(ttlSeconds))
    const envelope: CacheEnvelope<unknown> = { exp, data }
    await this.#cache.set(
      key,
      JSON.stringify(envelope),
      ttlSeconds + graceSeconds,
    )
  }

  // ─────────────────────────────── Telemetry ──────────────────────────────

  /**
   * Env-namespaced quota counters (dev traffic must not pollute prod metrics).
   * Fire-and-forget: never awaited in the hot path.
   */
  #quotaKey(kind: 'calls' | 'hits'): string {
    const date = saleRolloverDateString(this.#saleRolloverTimeZone)
    return `${this.#cacheNamespace}quota:${date}:${kind}`
  }

  #recordCall(): void {
    void this.#cache?.incr(this.#quotaKey('calls'), QUOTA_TTL_SECONDS)
  }

  #recordHit(): void {
    void this.#cache?.incr(this.#quotaKey('hits'), QUOTA_TTL_SECONDS)
  }
}

function isRetryable(err: unknown): boolean {
  if (err instanceof BestBuyHttpError) return err.isRetryable
  if (err instanceof BestBuyNetworkError) return true
  return false
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

/** Decode a cached envelope string; null on miss or corrupt/legacy shape. */
function decodeEnvelope<T>(
  raw: string | null | undefined,
): CacheEnvelope<T> | null {
  if (raw == null) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as CacheEnvelope<T>).exp === 'number' &&
      'data' in parsed
    ) {
      return parsed as CacheEnvelope<T>
    }
  } catch {
    // Corrupt entry (e.g. hand-edited in the data browser): treat as a miss.
  }
  return null
}

/** Trim, uppercase, strip internal spaces — "  n9a 6j3 " → "N9A6J3". */
function normalizePostalCode(postalCode: string): string {
  return postalCode.replace(/\s+/g, '').toUpperCase()
}

/** Dedupe + validate positive safe-integer SKUs, preserving first-seen order. */
function dedupePositiveInts(values: number[]): number[] {
  const seen = new Set<number>()
  const out: number[] = []
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value <= 0) continue
    if (seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

/** Dedupe + validate UPC strings, preserving first-seen order. */
function dedupeUpcs(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    if (!/^\d{6,14}$/.test(value)) continue
    if (seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

/**
 * Map an error body to a typed error. Best Buy uses two shapes:
 * `{"errorCode","errorMessage"}` (rate limits) and `{"error":{"code","message"}}`.
 * Never include the request URL here — it contains the API key. Worse,
 * Best Buy's OWN 400 messages echo the full request URL *including the
 * apiKey* (measured live 2026-07-06, IMA-23), so extracted messages are
 * scrubbed before they can reach a log line or a client response.
 */
function toHttpError(status: number, body: string): BestBuyHttpError {
  let message: string | null = null
  let errorCode: string | null = null
  try {
    const json = JSON.parse(body) as Record<string, unknown>
    if (typeof json.errorMessage === 'string') message = json.errorMessage
    if (typeof json.errorCode === 'string') errorCode = json.errorCode
    const nested = json.error
    if (typeof nested === 'object' && nested !== null) {
      const err = nested as Record<string, unknown>
      if (message === null && typeof err.message === 'string')
        message = err.message
      if (errorCode === null && typeof err.code === 'string')
        errorCode = err.code
    }
  } catch {
    // Non-JSON error body; fall through to the default message.
  }
  return new BestBuyHttpError(
    status,
    message === null ? defaultErrorMessage(status) : scrubApiKey(message),
    errorCode,
  )
}

/** Redact any apiKey value embedded in a Best Buy-authored message. */
function scrubApiKey(message: string): string {
  return message.replace(/apiKey=[^&'"\s)]+/gi, 'apiKey=REDACTED')
}

function defaultErrorMessage(status: number): string {
  switch (status) {
    case 400:
      return 'Bad request: invalid query syntax'
    case 401:
      return 'Unauthorized: invalid API key'
    case 403:
      return 'Forbidden: API key rejected or rate limited'
    case 404:
      return 'Resource not found'
    case 429:
      return 'Rate limit exceeded'
    case 500:
      return 'Best Buy internal server error'
    case 503:
      return 'Best Buy service temporarily unavailable'
    default:
      return `Best Buy HTTP error ${status}`
  }
}

let singleton: BestBuyClient | null = null

/** Process-wide client: env API key + shared Upstash cache. Server-only. */
export function getBestBuyClient(): BestBuyClient {
  if (singleton === null) {
    const apiKey = process.env.BESTBUY_API_KEY
    if (!apiKey) {
      throw new BestBuyError(
        'BESTBUY_API_KEY is not set. Run `vercel env pull .env.local` for local dev.',
      )
    }
    singleton = new BestBuyClient({ apiKey, cache: createCacheFromEnv() })
  }
  return singleton
}
