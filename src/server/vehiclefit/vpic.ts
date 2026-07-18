import { type CacheStore, createCacheFromEnv } from '#/server/bestbuy/cache'

const VPIC_MODELS_TTL_SECONDS = 30 * 24 * 60 * 60
const VPIC_BASE_URL = 'https://vpic.nhtsa.dot.gov/api/vehicles'

export interface VehicleHints {
  make: string
  model: string
  year?: number
}

export interface VehicleMatch {
  make: string
  model: string
  matched: boolean
  candidates: string[]
  /** Present when vPIC could not be reached or returned an invalid response. */
  error?: string
}

export interface VpicClientOptions {
  fetchImpl?: typeof fetch
  /** Injected cache seam. Only get/set are needed for vPIC's model lists. */
  cache?: Pick<CacheStore, 'get' | 'set'> | null
  baseUrl?: string
}

/**
 * Small server-only client for NHTSA's free, keyless vPIC vehicle API.
 *
 * vPIC's GetModelsForMake endpoint does not filter by year. The year hint is
 * retained by the caller for display and subsequent cargo-spec research.
 */
export class VpicClient {
  readonly #fetch: typeof fetch
  readonly #cache: Pick<CacheStore, 'get' | 'set'> | null
  readonly #baseUrl: string

  constructor(options: VpicClientOptions = {}) {
    this.#fetch = options.fetchImpl ?? fetch
    this.#cache = options.cache ?? null
    this.#baseUrl = options.baseUrl ?? VPIC_BASE_URL
  }

  /**
   * Confirm a model against vPIC's make model list. Network and cache failures
   * are converted into an ordinary unmatched result so the agent loop survives.
   */
  async identifyVehicle(hints: VehicleHints): Promise<VehicleMatch> {
    const make = hints.make.trim()
    const model = hints.model.trim()
    if (!make || !model) {
      return {
        make,
        model,
        matched: false,
        candidates: [],
        error: 'Both make and model are required.',
      }
    }

    const models = await this.#modelsForMake(make)
    if ('error' in models) {
      return {
        make,
        model,
        matched: false,
        candidates: [],
        error: models.error,
      }
    }

    const normalizedModel = normalize(model)
    const matched = models.values.some((candidate) =>
      isSubstringMatch(normalizedModel, normalize(candidate)),
    )
    return {
      make,
      model,
      matched,
      candidates: matched
        ? []
        : closeCandidates(normalizedModel, models.values).slice(0, 5),
    }
  }

  async #modelsForMake(
    make: string,
  ): Promise<{ values: string[] } | { error: string }> {
    const key = `vpic:models:${normalize(make)}`
    const cached = await this.#readCache(key)
    if (cached !== null) return { values: cached }

    let response: Response
    try {
      response = await this.#fetch(
        `${this.#baseUrl}/getmodelsformake/${encodeURIComponent(make)}?format=json`,
      )
    } catch {
      return { error: 'Vehicle lookup is temporarily unavailable.' }
    }
    if (!response.ok) {
      return { error: 'Vehicle lookup is temporarily unavailable.' }
    }

    let body: unknown
    try {
      body = await response.json()
    } catch {
      return { error: 'Vehicle lookup returned an unreadable response.' }
    }
    const values = parseModelNames(body)
    if (values === null) {
      return { error: 'Vehicle lookup returned an invalid response.' }
    }

    await this.#writeCache(key, values)
    return { values }
  }

  async #readCache(key: string): Promise<string[] | null> {
    if (this.#cache === null) return null
    try {
      const raw = await this.#cache.get(key)
      if (raw === null) return null
      const parsed: unknown = JSON.parse(raw)
      if (
        Array.isArray(parsed) &&
        parsed.every((value) => typeof value === 'string')
      ) {
        return parsed
      }
    } catch {
      // A cache outage or malformed entry is a miss, never an agent failure.
    }
    return null
  }

  async #writeCache(key: string, values: string[]): Promise<void> {
    if (this.#cache === null) return
    try {
      await this.#cache.set(
        key,
        JSON.stringify(values),
        VPIC_MODELS_TTL_SECONDS,
      )
    } catch {
      // vPIC remains usable when Redis is unavailable.
    }
  }
}

function parseModelNames(body: unknown): string[] | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return null
  }
  const results = (body as Record<string, unknown>).Results
  if (!Array.isArray(results)) return null

  const names: string[] = []
  for (const result of results) {
    if (typeof result !== 'object' || result === null || Array.isArray(result)) {
      continue
    }
    const name = (result as Record<string, unknown>).Model_Name
    if (typeof name !== 'string' || name.trim().length === 0) continue
    if (!names.includes(name.trim())) names.push(name.trim())
  }
  return names
}

function normalize(value: string): string {
  return value.toLocaleLowerCase('en-US').replace(/[^a-z0-9]/g, '')
}

function isSubstringMatch(query: string, candidate: string): boolean {
  return query.length > 0 && (candidate.includes(query) || query.includes(candidate))
}

function closeCandidates(query: string, candidates: string[]): string[] {
  return [...candidates]
    .sort((left, right) => {
      const scoreDifference = candidateScore(query, normalize(right)) - candidateScore(query, normalize(left))
      return scoreDifference !== 0 ? scoreDifference : left.localeCompare(right)
    })
    .slice(0, 5)
}

function candidateScore(query: string, candidate: string): number {
  if (query.length === 0 || candidate.length === 0) return 0
  const prefix = commonPrefixLength(query, candidate)
  const distance = levenshteinDistance(query, candidate)
  return prefix * 4 - distance
}

function commonPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length)
  let length = 0
  while (length < limit && left[length] === right[length]) length += 1
  return length
}

function levenshteinDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex]
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] +
          (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      )
    }
    for (let index = 0; index < previous.length; index += 1) {
      previous[index] = current[index]
    }
  }
  return previous[right.length]
}

let singleton: VpicClient | null = null

/** Process-wide vPIC client using the shared Redis cache when configured. */
export function getVpicClient(): VpicClient {
  if (singleton === null) singleton = new VpicClient({ cache: createCacheFromEnv() })
  return singleton
}
