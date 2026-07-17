// Catalog fetch with a three-step fallback chain:
//   models.dev (rich) → OpenRouter /api/v1/models (degraded) → last-good snapshot.
// Both upstreams are CORS-open (`access-control-allow-origin: *`, verified
// 2026-07-05), so this runs entirely in the browser — no server function.

import {
  type ModelsDevPayload,
  normalizeModelsDev,
  normalizeOpenRouter,
  type OpenRouterPayload,
} from './normalize'
import type { ModelCatalog } from './types'

const MODELS_DEV_URL = 'https://models.dev/api.json'
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models'

/**
 * Bump the suffix when ModelRecord's shape changes to invalidate old
 * snapshots. v2: dropped the `free` flag — free models are now excluded from
 * the catalog entirely (IMA-44), and v1 snapshots still contain them.
 */
export const CATALOG_SNAPSHOT_KEY = 'imagine:model-catalog:v2'

const FETCH_TIMEOUT_MS = 8_000

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`${url} responded ${response.status}`)
  return (await response.json()) as T
}

export function readCatalogSnapshot(): ModelCatalog | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(CATALOG_SNAPSHOT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ModelCatalog
    if (!Array.isArray(parsed.models) || parsed.models.length === 0) return null
    return { ...parsed, source: 'cache' }
  } catch {
    return null
  }
}

function writeCatalogSnapshot(catalog: ModelCatalog): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(CATALOG_SNAPSHOT_KEY, JSON.stringify(catalog))
  } catch {
    // Storage full or blocked — the snapshot is an optimization, never fatal.
  }
}

export async function fetchModelCatalog(): Promise<ModelCatalog> {
  try {
    const payload = await fetchJson<ModelsDevPayload>(MODELS_DEV_URL)
    const models = normalizeModelsDev(payload)
    if (models.length === 0)
      throw new Error('models.dev returned no OpenRouter models')
    const catalog: ModelCatalog = {
      source: 'models.dev',
      fetchedAt: Date.now(),
      models,
    }
    writeCatalogSnapshot(catalog)
    return catalog
  } catch {
    // Fall through to OpenRouter.
  }

  try {
    const payload = await fetchJson<OpenRouterPayload>(OPENROUTER_MODELS_URL)
    const models = normalizeOpenRouter(payload)
    if (models.length === 0) throw new Error('OpenRouter returned no models')
    const catalog: ModelCatalog = {
      source: 'openrouter',
      fetchedAt: Date.now(),
      models,
    }
    writeCatalogSnapshot(catalog)
    return catalog
  } catch {
    // Fall through to the snapshot.
  }

  const snapshot = readCatalogSnapshot()
  if (snapshot) return snapshot

  throw new Error(
    'Could not load the model catalog — models.dev and OpenRouter are both unreachable.',
  )
}
