import { BestBuyParseError } from '#/server/bestbuy/errors'

/**
 * Pure Exa web-search plumbing (IMA-8): request body, response parsing,
 * cache keys. No fetch, no env — the server function owns those, so this
 * module stays trivially testable.
 *
 * Exa is the agent's window past the catalog: spec sheets the BB data
 * omits, review sentiment, release context. Catalog stays authoritative
 * for Best Buy price/stock — the prompt (IMA-7) enforces that split.
 */

export interface WebSearchResult {
  title: string
  url: string
  /** ISO date when Exa knows it; null otherwise. */
  publishedDate: string | null
  /** Page-text excerpt (maxCharacters-capped by the request). */
  text: string
}

export const WEB_SEARCH_MAX_RESULTS = 8
export const WEB_SEARCH_DEFAULT_RESULTS = 5
/** Per-result excerpt cap — enough for a spec table, lean on tokens. */
export const WEB_SEARCH_EXCERPT_CHARS = 1500

/**
 * Floor questions cluster around the same hot products, so identical
 * queries within a shift should cost one Exa call (~$0.007). Web content
 * moves slower than stock: 6 hours.
 */
export const WEB_SEARCH_TTL_SECONDS = 6 * 60 * 60

const KEY_SCHEMA_VERSION = 'v1'

/**
 * Same environment split as the BB cache (see bestbuy/cache.ts): production
 * and preview share entries; local dev and tests write a `dev` namespace so
 * experiments can't poison what production reads.
 */
export function resolveWebCacheNamespace(
  vercelEnv: string | undefined = process.env.VERCEL_ENV,
): string {
  const shared = vercelEnv === 'production' || vercelEnv === 'preview'
  return shared
    ? `web:${KEY_SCHEMA_VERSION}:`
    : `web:dev:${KEY_SCHEMA_VERSION}:`
}

/** Whitespace-collapsed, lowercased query so trivial rephrasings share an entry. */
export function normalizeWebQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ').toLowerCase()
}

export function buildWebCacheKey(
  namespace: string,
  query: string,
  numResults: number,
): string {
  return `${namespace}search:${numResults}:${normalizeWebQuery(query)}`
}

/** POST body for https://api.exa.ai/search — auto mode picks neural/keyword. */
export function buildExaRequestBody(
  query: string,
  numResults: number,
): Record<string, unknown> {
  return {
    query,
    type: 'auto',
    numResults,
    contents: {
      text: { maxCharacters: WEB_SEARCH_EXCERPT_CHARS },
    },
  }
}

/**
 * Tolerant parse of Exa's /search response. Results missing a title or URL
 * are dropped rather than failing the batch; a response without a results
 * array at all is a hard parse error (reusing the shared error taxonomy).
 */
export function parseExaResponse(raw: unknown): WebSearchResult[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new BestBuyParseError('Expected JSON object for Exa response')
  }
  const results = (raw as Record<string, unknown>).results
  if (!Array.isArray(results)) {
    throw new BestBuyParseError('Exa response missing results array')
  }
  const parsed: WebSearchResult[] = []
  for (const item of results) {
    if (typeof item !== 'object' || item === null) continue
    const obj = item as Record<string, unknown>
    const title = typeof obj.title === 'string' ? obj.title.trim() : ''
    const url = typeof obj.url === 'string' ? obj.url.trim() : ''
    if (title.length === 0 || url.length === 0) continue
    parsed.push({
      title,
      url,
      publishedDate:
        typeof obj.publishedDate === 'string' && obj.publishedDate.length > 0
          ? obj.publishedDate
          : null,
      text: typeof obj.text === 'string' ? obj.text.trim() : '',
    })
  }
  return parsed
}
