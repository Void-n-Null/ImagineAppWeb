import process from 'node:process'
import { Redis } from '@upstash/redis'

/**
 * Redis-backed response cache for the Best Buy client (IMA-3).
 *
 * One Upstash database is shared by ALL environments (verified 2026-07-05),
 * so keys carry both a schema version and an environment namespace:
 * - production + preview share `bb:v2:` — the whole point is one lookup/day
 *   serving every user, which neutralizes the 50k/day + 5/sec key limits
 * - everything else (local dev, tests) writes `bb:dev:v2:` so in-progress
 *   cache experiments can never poison entries production reads
 *
 * Schema v2 (IMA-optimizations) adds entity-keyed product/upc caches, envelope
 * wrapping for stale-if-error grace, and quota telemetry. Schema v3 (IMA-10)
 * widens the product DTO (physical dims, warranty, facets) — bumped so v2
 * entities missing the new fields are never served as if complete. Schema v4
 * (IMA-29) adds the manufacturer `details` spec sheet to the DTO. Old
 * entries are simply left to expire unread.
 *
 * Keys are fully readable (no hashing) to keep the audit story trivial:
 * `bb:v4:/products(sku=6538984)?pageSize=1&show=...`, `bb:v4:product:6538984`.
 */

export interface CacheStore {
  /** Returns the cached string, or null on miss (or backend failure). */
  get(key: string): Promise<string | null>
  /**
   * Bulk get preserving input order; each slot is the value or null (miss or
   * backend failure). Guards the empty-array case (returns []).
   */
  getMany(keys: string[]): Promise<(string | null)[]>
  /** Best-effort write with a TTL; failures must not throw. */
  set(key: string, value: string, ttlSeconds: number): Promise<void>
  /**
   * Best-effort atomic increment for quota counters. Sets the TTL only when
   * the counter is first created (value becomes 1) so the window is never
   * reset by later increments. Failures are swallowed.
   */
  incr(key: string, ttlSeconds: number): Promise<void>
}

/**
 * The clock that governs Best Buy's national daily-deal rollover.
 *
 * This app serves the open internet (US/Canada), not a single store, so there
 * is NO user/home timezone to assume. Best Buy's sales roll over nationally at
 * midnight Central Time (HQ is in Richfield, Minnesota) — that is the boundary
 * at which catalog/pricing cache entries should expire, everywhere.
 */
export const SALE_ROLLOVER_TIMEZONE = 'America/Chicago'

const KEY_SCHEMA_VERSION = 'v4'

export function resolveCacheNamespace(
  vercelEnv: string | undefined = process.env.VERCEL_ENV,
): string {
  const shared = vercelEnv === 'production' || vercelEnv === 'preview'
  return shared ? `bb:${KEY_SCHEMA_VERSION}:` : `bb:dev:${KEY_SCHEMA_VERSION}:`
}

/**
 * Normalized cache key: namespace + path + params sorted by name.
 * Callers must never include the API key in `params`.
 */
export function buildCacheKey(
  namespace: string,
  path: string,
  params: Record<string, string>,
): string {
  const query = Object.entries(params)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
  return query.length > 0
    ? `${namespace}${path}?${query}`
    : `${namespace}${path}`
}

/**
 * Seconds from `now` until the next midnight in `timeZone` — v1's ProductCache
 * invalidation logic (Best Buy's national sales roll over daily at Central-time
 * midnight; see {@link SALE_ROLLOVER_TIMEZONE}). Clamped to at least 60s so a
 * scan seconds before midnight still caches. May drift ±1h on the two DST
 * transition days; irrelevant at this precision.
 */
export function secondsUntilLocalMidnight(
  timeZone: string = SALE_ROLLOVER_TIMEZONE,
  now: Date = new Date(),
): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  }).formatToParts(now)
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0)
  // Intl reports midnight as hour 24 in some ICU versions; normalize.
  const hour = get('hour') % 24
  const elapsed = hour * 3600 + get('minute') * 60 + get('second')
  return Math.max(60, 86_400 - elapsed)
}

/**
 * The current date as `YYYY-MM-DD` in the sale-rollover zone. Used to bucket
 * quota telemetry into the same daily window Best Buy's quota resets on.
 * 'en-CA' formats natively as ISO `YYYY-MM-DD`.
 */
export function saleRolloverDateString(
  timeZone: string = SALE_ROLLOVER_TIMEZONE,
  now: Date = new Date(),
): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/**
 * Upstash-backed store. All failures degrade to cache-miss behavior — a
 * Redis outage must never take product lookups down with it.
 */
export class UpstashCache implements CacheStore {
  readonly #redis: Redis

  constructor(redis: Redis) {
    this.#redis = redis
  }

  async get(key: string): Promise<string | null> {
    try {
      return await this.#redis.get<string>(key)
    } catch (err) {
      console.warn(`[bb-cache] get failed for ${key}:`, err)
      return null
    }
  }

  async getMany(keys: string[]): Promise<(string | null)[]> {
    if (keys.length === 0) return []
    try {
      return await this.#redis.mget<string[]>(...keys)
    } catch (err) {
      console.warn(`[bb-cache] mget failed for ${keys.length} keys:`, err)
      return keys.map(() => null)
    }
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    try {
      await this.#redis.set(key, value, {
        ex: Math.max(1, Math.floor(ttlSeconds)),
      })
    } catch (err) {
      console.warn(`[bb-cache] set failed for ${key}:`, err)
    }
  }

  async incr(key: string, ttlSeconds: number): Promise<void> {
    try {
      const value = await this.#redis.incr(key)
      // Only set expiry on the first increment so the window is stable.
      if (value === 1) {
        await this.#redis.expire(key, Math.max(1, Math.floor(ttlSeconds)))
      }
    } catch (err) {
      console.warn(`[bb-cache] incr failed for ${key}:`, err)
    }
  }
}

/**
 * Build the process-wide cache from Vercel's Upstash env vars, or null when
 * they're absent (e.g. CI) — the client treats null as "no caching".
 */
export function createCacheFromEnv(): CacheStore | null {
  const url = process.env.KV_REST_API_URL
  const token = process.env.KV_REST_API_TOKEN
  if (!url || !token) {
    console.warn(
      '[bb-cache] KV_REST_API_URL/TOKEN not set — Best Buy caching disabled',
    )
    return null
  }
  // Values are our own JSON strings; disable the client's implicit
  // (de)serialization so this layer stays a plain string store.
  return new UpstashCache(
    new Redis({ url, token, automaticDeserialization: false }),
  )
}
