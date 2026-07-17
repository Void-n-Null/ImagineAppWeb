import process from 'node:process'
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

/**
 * Shared sliding-window rate limiter (IMA-17). Extracted from
 * api.agent.turn.ts so the turn endpoint and any other spend-bearing server
 * entrypoint (voice transcription, IMA-17 #357) share one construct-from-env
 * idiom and one "fail open when no Redis is configured" policy.
 *
 * Each bucket enforces TWO windows keyed by our serial user id: a per-minute
 * burst guard and a per-day ceiling. `checkRateLimit` reports the longer wait
 * when either window is exceeded, so the caller can surface a single
 * Retry-After.
 *
 * KV_REST_API_URL / KV_REST_API_TOKEN exist in every environment (dev,
 * preview, and prod share one Upstash db). Analytics is off — the extra Redis
 * writes per check buy us nothing here.
 */

export interface RateLimits {
  /** Requests allowed per rolling minute. */
  perMinute: number
  /** Requests allowed per rolling day. */
  perDay: number
  /**
   * Redis key prefix for this bucket, e.g. 'rl:turn:' or 'rl:voice:'. The
   * helper appends 'min' / 'day' to distinguish the two windows.
   */
  prefix: string
}

export interface RateResult {
  ok: boolean
  retryAfterSeconds: number
}

interface Limiters {
  minute: Ratelimit
  day: Ratelimit
}

// One Redis client + one pair of limiters PER bucket prefix, cached at module
// scope. Two different call sites (turn, voice) each get their own pair keyed
// by prefix so their windows never collide.
let sharedRedis: Redis | null | undefined
const limitersByPrefix = new Map<string, Limiters | null>()

function getRedis(): Redis | null {
  if (sharedRedis === undefined) {
    sharedRedis =
      process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN
        ? Redis.fromEnv()
        : null
  }
  return sharedRedis
}

function getLimiters(limits: RateLimits): Limiters | null {
  const cached = limitersByPrefix.get(limits.prefix)
  if (cached !== undefined) return cached

  const redis = getRedis()
  if (!redis) {
    limitersByPrefix.set(limits.prefix, null)
    return null
  }

  const pair: Limiters = {
    minute: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(limits.perMinute, '1 m'),
      prefix: `${limits.prefix}min`,
      analytics: false,
    }),
    day: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(limits.perDay, '1 d'),
      prefix: `${limits.prefix}day`,
      analytics: false,
    }),
  }
  limitersByPrefix.set(limits.prefix, pair)
  return pair
}

/**
 * Check both windows for `bucket` limits under `userId`. When no Redis is
 * configured (a bare local env) this fails OPEN rather than locking everyone
 * out — the ceiling still exists in prod where KV is wired.
 */
export async function checkRateLimit(
  userId: number,
  limits: RateLimits,
): Promise<RateResult> {
  const limiters = getLimiters(limits)
  if (!limiters) return { ok: true, retryAfterSeconds: 0 }

  const key = String(userId)
  const [minute, day] = await Promise.all([
    limiters.minute.limit(key),
    limiters.day.limit(key),
  ])
  if (minute.success && day.success) return { ok: true, retryAfterSeconds: 0 }

  const now = Date.now()
  const waits = [minute, day]
    .filter((r) => !r.success)
    .map((r) => Math.max(1, Math.ceil((r.reset - now) / 1000)))
  return { ok: false, retryAfterSeconds: Math.max(...waits) }
}

/** Bucket presets so both call sites agree on the numbers in one place. */
export const TURN_RATE_LIMITS: RateLimits = {
  perMinute: 10,
  perDay: 200,
  prefix: 'rl:turn:',
}

export const VOICE_RATE_LIMITS: RateLimits = {
  perMinute: 20,
  perDay: 300,
  prefix: 'rl:voice:',
}
