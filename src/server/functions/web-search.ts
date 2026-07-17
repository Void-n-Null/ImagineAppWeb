import process from 'node:process'
import { createServerFn } from '@tanstack/react-start'
import { requireUser, UnauthorizedError } from '#/server/auth'
import { type CacheStore, createCacheFromEnv } from '#/server/bestbuy/cache'
import { recordSpend } from '#/server/credits/ledger'
import { getDb } from '#/server/db'
import {
  buildExaRequestBody,
  buildWebCacheKey,
  parseExaResponse,
  resolveWebCacheNamespace,
  WEB_SEARCH_DEFAULT_RESULTS,
  WEB_SEARCH_MAX_RESULTS,
  WEB_SEARCH_TTL_SECONDS,
  type WebSearchResult,
} from '#/server/websearch/exa'

/**
 * Exa web search — the backend for the agent's web_search tool (IMA-8).
 *
 * EXA_API_KEY is server-only (never VITE_-prefixed). Results are cached in
 * the shared Redis under a `web:` namespace with a short TTL: floor
 * questions cluster around the same hot products, and at ~$0.007/search a
 * cache hit is pure margin. All failures return error VALUES so the model
 * can react instead of the loop dying.
 *
 * Metering (IMA-16 Phase 3): the search is gated on sign-in and metered at
 * $0.007 per LIVE Exa fetch. Cache HITS are free by design — measured
 * ~$0.31/user/month unmetered (IMA-DOC-16), and the cache is where that margin
 * comes back. A spend-record failure must NOT fail the search (log + continue);
 * these spends carry no generationId, so the ledger's dedupe index doesn't
 * apply — that's fine, this fires exactly once per fetch.
 */

/** Per-live-Exa-fetch cost (IMA-DOC-16 measured). Cache hits are free. */
const WEB_SEARCH_COST_USD = 0.007

export type WebSearchFnResult =
  | { status: 'ok'; results: WebSearchResult[] }
  | { status: 'error'; message: string }

interface WebSearchInput {
  query: string
  numResults: number
}

const EXA_SEARCH_URL = 'https://api.exa.ai/search'

function validateInput(input: unknown): WebSearchInput {
  const obj = (input ?? {}) as Record<string, unknown>
  if (typeof obj.query !== 'string' || obj.query.trim().length < 2) {
    throw new Error('webSearch expects a query string (min 2 chars)')
  }
  const numResults =
    typeof obj.numResults === 'number' && Number.isSafeInteger(obj.numResults)
      ? Math.min(Math.max(obj.numResults, 1), WEB_SEARCH_MAX_RESULTS)
      : WEB_SEARCH_DEFAULT_RESULTS
  return { query: obj.query.trim().slice(0, 300), numResults }
}

// Lazy singleton — same construction-from-env idiom as the BB client.
let cache: CacheStore | null | undefined
function getCache(): CacheStore | null {
  if (cache === undefined) cache = createCacheFromEnv()
  return cache
}

async function fetchExa(
  apiKey: string,
  input: WebSearchInput,
): Promise<WebSearchFnResult> {
  const response = await fetch(EXA_SEARCH_URL, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify(buildExaRequestBody(input.query, input.numResults)),
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) {
    return {
      status: 'error',
      message:
        response.status === 429
          ? 'Web search is rate limited — retry in a moment'
          : `Web search failed (HTTP ${response.status})`,
    }
  }
  return { status: 'ok', results: parseExaResponse(await response.json()) }
}

export const webSearch = createServerFn({ method: 'POST' })
  .inputValidator(validateInput)
  .handler(async ({ data }): Promise<WebSearchFnResult> => {
    // Auth: web search is now gated (it costs Blake's money). Signed-out is an
    // error value, never a spend. (Was UNAUTHENTICATED before IMA-16 Phase 3.)
    let userId: number
    try {
      const user = await requireUser()
      userId = user.id
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        return { status: 'error', message: 'Sign in to search the web' }
      }
      throw err
    }

    const apiKey = process.env.EXA_API_KEY
    if (!apiKey) {
      return { status: 'error', message: 'Web search is not configured' }
    }

    const store = getCache()
    const key = buildWebCacheKey(
      resolveWebCacheNamespace(),
      data.query,
      data.numResults,
    )

    const cached = await store?.get(key)
    if (cached != null) {
      try {
        return {
          status: 'ok',
          results: JSON.parse(cached) as WebSearchResult[],
        }
      } catch {
        // Corrupt entry — fall through to a fresh fetch that overwrites it.
      }
    }

    try {
      const result = await fetchExa(apiKey, data)
      if (result.status === 'ok') {
        await store?.set(
          key,
          JSON.stringify(result.results),
          WEB_SEARCH_TTL_SECONDS,
        )
        // Meter the LIVE fetch only (this is a cache MISS path). Spend failure
        // must not fail the search — log and return results anyway.
        try {
          await recordSpend(getDb(), userId, WEB_SEARCH_COST_USD, {
            tool: 'web_search',
          })
        } catch (spendErr) {
          console.error('[web-search] SPEND RECORD FAILED', {
            userId,
            err: spendErr,
          })
        }
      }
      return result
    } catch (err) {
      // Timeouts, DNS, parse errors — the model gets a value, not a crash.
      const message = err instanceof Error ? err.message : String(err)
      return { status: 'error', message: `Web search failed: ${message}` }
    }
  })
