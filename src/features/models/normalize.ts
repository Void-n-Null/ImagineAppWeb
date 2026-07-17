// Pure normalizers: raw API payloads → ModelRecord[].
// Kept side-effect-free so they can be unit-tested against fixture payloads.

import type { ModelCost, ModelRecord } from './types'

/** Slug prefix, with models.dev's "~" variant marker stripped. */
export function vendorOf(id: string): string {
  const prefix = id.split('/')[0] ?? id
  return prefix.replace(/^~/, '')
}

/**
 * Free models don't exist as far as this app is concerned (IMA-44): every
 * request routes with a mandatory zero-data-retention provider policy (Best
 * Buy ToS, IMA-42), and the IMA-43 audit found no free model with a compliant
 * endpoint — selecting one can only ever 404. Both normalizers drop them at
 * the source so no list, search, count, or detail page ever shows one.
 */
function isFree(id: string, cost: ModelCost): boolean {
  if (id.endsWith(':free')) return true
  return cost.input === 0 && cost.output === 0
}

// ── models.dev ──────────────────────────────────────────────────────────────
// https://models.dev/api.json → { [providerId]: { id, name, models: { [modelId]: {...} } } }

interface ModelsDevModel {
  id: string
  name?: string
  description?: string
  reasoning?: boolean
  tool_call?: boolean
  structured_output?: boolean
  attachment?: boolean
  modalities?: { input?: string[]; output?: string[] }
  limit?: { context?: number; output?: number }
  cost?: {
    input?: number
    output?: number
    cache_read?: number
    cache_write?: number
  }
  release_date?: string
  knowledge?: string
  open_weights?: boolean
}

export interface ModelsDevPayload {
  openrouter?: { models?: Record<string, ModelsDevModel> }
}

export function normalizeModelsDev(payload: ModelsDevPayload): ModelRecord[] {
  const models = payload.openrouter?.models
  if (!models) return []

  return Object.values(models)
    .filter((m): m is ModelsDevModel => typeof m?.id === 'string')
    .flatMap((m) => {
      const cost: ModelCost = {
        input: m.cost?.input,
        output: m.cost?.output,
        cacheRead: m.cost?.cache_read,
        cacheWrite: m.cost?.cache_write,
      }
      if (isFree(m.id, cost)) return []
      return {
        id: m.id,
        name: m.name ?? m.id,
        description: m.description ?? '',
        vendor: vendorOf(m.id),
        reasoning: m.reasoning === true,
        toolCall: m.tool_call === true,
        structuredOutput: m.structured_output ?? null,
        inputModalities: m.modalities?.input ?? [],
        outputModalities: m.modalities?.output ?? [],
        contextLength: m.limit?.context ?? null,
        maxOutput: m.limit?.output ?? null,
        cost,
        releaseDate: m.release_date ?? null,
        knowledge: m.knowledge ?? null,
        openWeights: m.open_weights ?? null,
      } satisfies ModelRecord
    })
}

// ── OpenRouter fallback ─────────────────────────────────────────────────────
// https://openrouter.ai/api/v1/models → { data: [{ id, pricing: { prompt: "$/token" }, ... }] }
// Pricing arrives as USD-per-single-token strings; we convert to per-1M numbers.

interface OpenRouterModel {
  id: string
  name?: string
  description?: string
  context_length?: number | null
  architecture?: { input_modalities?: string[]; output_modalities?: string[] }
  pricing?: { prompt?: string; completion?: string }
  top_provider?: { max_completion_tokens?: number | null }
  supported_parameters?: string[]
}

export interface OpenRouterPayload {
  data?: OpenRouterModel[]
}

function perTokenToPerMillion(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return undefined
  // Round away float noise (e.g. 0.000003 * 1e6 = 2.9999999999999996).
  return Math.round(parsed * 1_000_000 * 1e6) / 1e6
}

export function normalizeOpenRouter(payload: OpenRouterPayload): ModelRecord[] {
  return (payload.data ?? [])
    .filter((m): m is OpenRouterModel => typeof m?.id === 'string')
    .flatMap((m) => {
      const params = m.supported_parameters ?? []
      const cost: ModelCost = {
        input: perTokenToPerMillion(m.pricing?.prompt),
        output: perTokenToPerMillion(m.pricing?.completion),
      }
      if (isFree(m.id, cost)) return []
      return {
        id: m.id,
        name: m.name ?? m.id,
        description: m.description ?? '',
        vendor: vendorOf(m.id),
        reasoning: params.includes('reasoning'),
        toolCall: params.includes('tools'),
        structuredOutput: params.includes('structured_outputs') ? true : null,
        inputModalities: m.architecture?.input_modalities ?? [],
        outputModalities: m.architecture?.output_modalities ?? [],
        contextLength: m.context_length ?? null,
        maxOutput: m.top_provider?.max_completion_tokens ?? null,
        cost,
        releaseDate: null,
        knowledge: null,
        openWeights: null,
      } satisfies ModelRecord
    })
}
