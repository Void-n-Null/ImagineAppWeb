// Pure search / capability-filter / sort pipeline for the model browser.
// All three are URL-driven (typed search params on the /models route), so
// these functions are the single source of truth for what each value means.

import type { ModelRecord } from './types'

// No 'free' filter: free models are excluded from the catalog entirely at
// normalization (see normalize.ts / IMA-44) — none route under the mandatory
// zero-data-retention policy, so to this app they simply don't exist.
// Stale ?cap=free URLs fail isCapabilityFilter and degrade to "All".
export const CAPABILITY_FILTERS = ['reasoning', 'tools', 'vision'] as const
export type CapabilityFilter = (typeof CAPABILITY_FILTERS)[number]

export const SORT_MODES = ['newest', 'cheapest', 'context', 'name'] as const
export type SortMode = (typeof SORT_MODES)[number]

export const CAPABILITY_LABELS: Record<CapabilityFilter, string> = {
  reasoning: 'Reasoning',
  tools: 'Tools',
  vision: 'Vision',
}

export const SORT_LABELS: Record<SortMode, string> = {
  newest: 'Newest',
  cheapest: 'Cheapest',
  context: 'Largest context',
  name: 'A–Z',
}

export function isCapabilityFilter(value: unknown): value is CapabilityFilter {
  return (
    typeof value === 'string' &&
    (CAPABILITY_FILTERS as readonly string[]).includes(value)
  )
}

export function isSortMode(value: unknown): value is SortMode {
  return (
    typeof value === 'string' &&
    (SORT_MODES as readonly string[]).includes(value)
  )
}

export function hasVision(model: ModelRecord): boolean {
  return model.inputModalities.includes('image')
}

export function applyCapability(
  models: ModelRecord[],
  capability: CapabilityFilter | undefined,
): ModelRecord[] {
  switch (capability) {
    case 'reasoning':
      return models.filter((m) => m.reasoning)
    case 'tools':
      return models.filter((m) => m.toolCall)
    case 'vision':
      return models.filter(hasVision)
    default:
      return models
  }
}

/**
 * Substring search over name + id, ranked earliest-match-then-shortest
 * (proseus's ranking, which surfaces "the model you meant" well).
 */
export function searchModels(
  models: ModelRecord[],
  query: string,
): ModelRecord[] {
  const q = query.trim().toLowerCase()
  if (!q) return models

  const scored: Array<{ model: ModelRecord; score: number }> = []
  for (const model of models) {
    const inName = model.name.toLowerCase().indexOf(q)
    const inId = model.id.toLowerCase().indexOf(q)
    if (inName === -1 && inId === -1) continue
    const position =
      inName === -1 ? inId : inId === -1 ? inName : Math.min(inName, inId)
    scored.push({ model, score: position * 1000 + model.id.length })
  }
  scored.sort((a, b) => a.score - b.score)
  return scored.map((s) => s.model)
}

/** Blended per-1M price used for the "cheapest" sort. */
export function blendedCost(model: ModelRecord): number | null {
  const { input, output } = model.cost
  if (input === undefined && output === undefined) return null
  return (input ?? 0) + (output ?? 0)
}

export function sortModels(
  models: ModelRecord[],
  sort: SortMode,
): ModelRecord[] {
  const sorted = [...models]
  switch (sort) {
    case 'newest':
      // Unknown release dates (fallback source) sink to the bottom.
      sorted.sort((a, b) => {
        if (a.releaseDate === b.releaseDate) return a.name.localeCompare(b.name)
        if (a.releaseDate === null) return 1
        if (b.releaseDate === null) return -1
        return b.releaseDate.localeCompare(a.releaseDate)
      })
      break
    case 'cheapest':
      sorted.sort((a, b) => {
        const costA = blendedCost(a)
        const costB = blendedCost(b)
        if (costA === costB) return a.name.localeCompare(b.name)
        if (costA === null) return 1
        if (costB === null) return -1
        return costA - costB
      })
      break
    case 'context':
      sorted.sort((a, b) => {
        if (a.contextLength === b.contextLength)
          return a.name.localeCompare(b.name)
        if (a.contextLength === null) return 1
        if (b.contextLength === null) return -1
        return b.contextLength - a.contextLength
      })
      break
    case 'name':
      sorted.sort((a, b) => a.name.localeCompare(b.name))
      break
  }
  return sorted
}
