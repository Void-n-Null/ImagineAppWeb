/**
 * Normalized model-catalog types.
 *
 * The catalog can come from three places, best-first:
 *   1. models.dev  — rich: capability flags, release dates, cache pricing
 *   2. OpenRouter  — degraded: no release dates, no cache pricing, fewer flags
 *   3. localStorage snapshot of the last good fetch (offline / both APIs down)
 *
 * Everything the UI touches is normalized into ModelRecord so components never
 * branch on the source; fields the fallback can't provide are null.
 */

export type CatalogSource = 'models.dev' | 'openrouter' | 'cache'

/** USD per 1,000,000 tokens. Absent dimensions are undefined. */
export interface ModelCost {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
}

export interface ModelRecord {
  /** OpenRouter slug, e.g. "anthropic/claude-sonnet-4.5". */
  id: string
  name: string
  description: string
  /** Slug prefix with models.dev's "~" variant marker stripped. */
  vendor: string
  reasoning: boolean
  toolCall: boolean
  /** null = the source couldn't tell us. */
  structuredOutput: boolean | null
  inputModalities: string[]
  outputModalities: string[]
  contextLength: number | null
  maxOutput: number | null
  cost: ModelCost
  /** ISO date, models.dev only. */
  releaseDate: string | null
  /** Knowledge cutoff ISO date, when known. */
  knowledge: string | null
  openWeights: boolean | null
}

export interface ModelCatalog {
  source: CatalogSource
  /** Epoch ms of the successful upstream fetch (survives the cache fallback). */
  fetchedAt: number
  models: ModelRecord[]
}
