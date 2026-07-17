import { describe, expect, it } from 'vitest'
import {
  applyCapability,
  blendedCost,
  isCapabilityFilter,
  isSortMode,
  searchModels,
  sortModels,
} from './filter'
import type { ModelRecord } from './types'

function record(overrides: Partial<ModelRecord> & { id: string }): ModelRecord {
  return {
    name: overrides.id,
    description: '',
    vendor: overrides.id.split('/')[0] ?? '',
    reasoning: false,
    toolCall: false,
    structuredOutput: null,
    inputModalities: ['text'],
    outputModalities: ['text'],
    contextLength: null,
    maxOutput: null,
    cost: {},
    releaseDate: null,
    knowledge: null,
    openWeights: null,
    ...overrides,
  }
}

const models = [
  record({
    id: 'anthropic/claude-sonnet-4.5',
    name: 'Claude Sonnet 4.5',
    reasoning: true,
    toolCall: true,
    inputModalities: ['text', 'image'],
    contextLength: 1_000_000,
    cost: { input: 3, output: 15 },
    releaseDate: '2025-09-29',
  }),
  record({
    id: 'google/gemini-3-flash-preview',
    name: 'Gemini 3 Flash',
    toolCall: true,
    contextLength: 262_144,
    cost: { input: 0.5, output: 3 },
    releaseDate: '2026-03-01',
  }),
  // No free fixture: free models are excluded from the catalog at
  // normalization (IMA-44), so filter/sort never see one.
  record({
    id: 'meta-llama/llama-3.3-70b-instruct',
    name: 'Llama 3.3 70B',
    contextLength: 131_072,
    cost: { input: 0.1, output: 0.25 },
  }),
]

describe('applyCapability', () => {
  it('filters reasoning / tools / vision', () => {
    expect(applyCapability(models, 'reasoning').map((m) => m.name)).toEqual([
      'Claude Sonnet 4.5',
    ])
    expect(applyCapability(models, 'tools')).toHaveLength(2)
    expect(applyCapability(models, 'vision').map((m) => m.name)).toEqual([
      'Claude Sonnet 4.5',
    ])
  })

  it('passes everything through for undefined', () => {
    expect(applyCapability(models, undefined)).toHaveLength(3)
  })
})

describe('searchModels', () => {
  it('matches name and id, case-insensitive', () => {
    expect(searchModels(models, 'GEMINI')).toHaveLength(1)
    expect(searchModels(models, 'meta-llama')).toHaveLength(1)
  })

  it('ranks earlier matches first', () => {
    const results = searchModels(models, 'claude')
    expect(results[0].name).toBe('Claude Sonnet 4.5')
  })

  it('returns the input for a blank query', () => {
    expect(searchModels(models, '  ')).toHaveLength(3)
  })
})

describe('sortModels', () => {
  it('newest: unknown dates sink to the bottom', () => {
    const names = sortModels(models, 'newest').map((m) => m.name)
    expect(names).toEqual([
      'Gemini 3 Flash',
      'Claude Sonnet 4.5',
      'Llama 3.3 70B',
    ])
  })

  it('cheapest: blended price ascending', () => {
    const names = sortModels(models, 'cheapest').map((m) => m.name)
    expect(names).toEqual([
      'Llama 3.3 70B',
      'Gemini 3 Flash',
      'Claude Sonnet 4.5',
    ])
  })

  it('context: largest first, unknown last', () => {
    const names = sortModels(models, 'context').map((m) => m.name)
    expect(names[0]).toBe('Claude Sonnet 4.5')
  })

  it('does not mutate the input', () => {
    const before = models.map((m) => m.id)
    sortModels(models, 'name')
    expect(models.map((m) => m.id)).toEqual(before)
  })
})

describe('blendedCost', () => {
  it('sums input + output and preserves null for unknown', () => {
    expect(blendedCost(models[0])).toBe(18)
    expect(blendedCost(record({ id: 'x/y' }))).toBeNull()
  })
})

describe('type guards', () => {
  it('validate search-param strings', () => {
    expect(isCapabilityFilter('vision')).toBe(true)
    expect(isCapabilityFilter('sentient')).toBe(false)
    // Removed in IMA-44 — stale ?cap=free URLs must degrade to "All".
    expect(isCapabilityFilter('free')).toBe(false)
    expect(isSortMode('cheapest')).toBe(true)
    expect(isSortMode('vibes')).toBe(false)
  })
})
