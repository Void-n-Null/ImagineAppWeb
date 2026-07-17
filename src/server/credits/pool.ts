import process from 'node:process'
import { Redis } from '@upstash/redis'

/**
 * The pool account's live balance + the grant invariant math (IMA-16 Phase 3,
 * design: IMA-DOC-16 "Pool allocation invariant").
 *
 * The "pool" is the app's single OpenRouter account (server-only
 * OPENROUTER_API_KEY). Its remaining USD balance gates whether a new signup
 * can be granted: grants are a liability we can only issue while the pool can
 * cover them plus a margin. `GET /api/v1/credits` returns cumulative totals;
 * remaining = total_credits − total_usage (both USD).
 *
 * Money units here are USD numbers used ONLY for threshold comparison and the
 * remaining-balance read — never for stored balance arithmetic (that happens
 * in SQL, see ledger.ts). GRANT_USD is a decimal STRING because it's inserted
 * into the numeric ledger column verbatim.
 */

/** One signup grant, as a decimal string for the numeric(12,8) ledger column. */
export const GRANT_USD = '0.50'
/** Same value as a number, for invariant comparisons only (never stored). */
export const GRANT_USD_NUM = 0.5
/**
 * Safety buffer subtracted from remaining before a grant is allowed. Absorbs
 * in-flight turns, unmetered slop, and OpenRouter generation-stats lag
 * (IMA-DOC-16). $1.00.
 */
export const MARGIN_USD = 1.0
/** Display unit: 1 credit = $0.005. UI does floor(balanceUsd / CREDIT_USD). */
export const CREDIT_USD = 0.005

const OPENROUTER_CREDITS_URL = 'https://openrouter.ai/api/v1/credits'
const OPENROUTER_GENERATION_URL = 'https://openrouter.ai/api/v1/generation'
const POOL_REMAINING_CACHE_KEY = 'credits:pool:remaining'
const POOL_REMAINING_TTL_SECONDS = 60

/**
 * The core invariant, extracted pure for testing (IMA-16 Phase 3 tests):
 * a grant is allowed iff the pool's remaining balance still covers all
 * outstanding (unspent) grant liability, the margin, AND the new grant.
 *
 *   remaining − outstanding − MARGIN ≥ GRANT
 *
 * `remaining` and `outstanding` are USD numbers; float error at the sub-cent
 * scale is irrelevant against a $1.00 margin.
 */
export function grantAllowed(remaining: number, outstanding: number): boolean {
  return remaining - outstanding - MARGIN_USD >= GRANT_USD_NUM
}

let poolRedis: Redis | null | undefined
function getPoolRedis(): Redis | null {
  if (poolRedis === undefined) {
    poolRedis =
      process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN
        ? Redis.fromEnv()
        : null
  }
  return poolRedis
}

interface CreditsResponse {
  data?: { total_credits?: unknown; total_usage?: unknown }
}

/**
 * The pool's remaining USD balance. Cached in Redis for 60s so the common
 * path (grant checks, admin reads) doesn't hammer OpenRouter; `fresh: true`
 * bypasses the cache and rewrites it (syncPool uses this before issuing a
 * batch of grants). Throws when OPENROUTER_API_KEY is unset — callers decide
 * whether that's fatal (grant → treat as un-grantable, admin → surface).
 */
export async function fetchPoolRemaining(opts?: {
  fresh?: boolean
}): Promise<number> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set')

  const redis = getPoolRedis()
  if (!opts?.fresh && redis) {
    const cached = await redis.get<number>(POOL_REMAINING_CACHE_KEY)
    // Upstash may return a number or a numeric string depending on how it was
    // written; coerce and accept any finite value (0 is legitimate).
    if (cached != null) {
      const value = typeof cached === 'number' ? cached : Number(cached)
      if (Number.isFinite(value)) return value
    }
  }

  const response = await fetch(OPENROUTER_CREDITS_URL, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) {
    throw new Error(`OpenRouter /credits failed (HTTP ${response.status})`)
  }
  const payload = (await response.json()) as CreditsResponse
  const totalCredits = Number(payload.data?.total_credits)
  const totalUsage = Number(payload.data?.total_usage)
  if (!Number.isFinite(totalCredits) || !Number.isFinite(totalUsage)) {
    throw new Error('OpenRouter /credits returned non-numeric totals')
  }
  const remaining = totalCredits - totalUsage

  if (redis) {
    // Best-effort cache write; a Redis failure must not sink the read.
    try {
      await redis.set(POOL_REMAINING_CACHE_KEY, remaining, {
        ex: POOL_REMAINING_TTL_SECONDS,
      })
    } catch (err) {
      console.warn('[credits] pool remaining cache write failed:', err)
    }
  }

  return remaining
}

/**
 * Cost fallback (IMA-16 #360, IMA-DOC-16 "Cost source of truth"). When a
 * completion's usage payload lacks `cost` but we have a generationId, the real
 * billed cost can be read from `GET /api/v1/generation?id=<id>`
 * (data.total_cost, USD). These stats are EVENTUALLY consistent, so callers
 * should delay ~1.5s before calling. Returns the positive cost, or null when
 * the key is unset / the request fails / the cost is absent or non-positive —
 * the caller decides (here: record iff positive). Never throws.
 */
export async function fetchGenerationCost(
  generationId: string,
): Promise<number | null> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return null
  try {
    const url = `${OPENROUTER_GENERATION_URL}?id=${encodeURIComponent(generationId)}`
    const response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return null
    const payload = (await response.json()) as {
      data?: { total_cost?: unknown }
    }
    const cost = Number(payload.data?.total_cost)
    return Number.isFinite(cost) && cost > 0 ? cost : null
  } catch {
    return null
  }
}
