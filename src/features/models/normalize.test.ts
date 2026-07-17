import { describe, expect, it } from 'vitest'
import { normalizeModelsDev, normalizeOpenRouter, vendorOf } from './normalize'

describe('vendorOf', () => {
  it('extracts the slug prefix', () => {
    expect(vendorOf('anthropic/claude-sonnet-4.5')).toBe('anthropic')
  })

  it("strips models.dev's ~ variant marker", () => {
    expect(vendorOf('~anthropic/claude-fable-latest')).toBe('anthropic')
  })

  it('returns the id when there is no slash', () => {
    expect(vendorOf('auto')).toBe('auto')
  })
})

describe('normalizeModelsDev', () => {
  const payload = {
    openrouter: {
      models: {
        'anthropic/claude-sonnet-4.5': {
          id: 'anthropic/claude-sonnet-4.5',
          name: 'Claude Sonnet 4.5',
          description: 'Balanced model.',
          reasoning: true,
          tool_call: true,
          structured_output: true,
          modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
          limit: { context: 1_000_000, output: 64_000 },
          cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
          release_date: '2025-09-29',
          knowledge: '2025-07-31',
          open_weights: false,
        },
        'meta-llama/llama-3.3-70b-instruct:free': {
          id: 'meta-llama/llama-3.3-70b-instruct:free',
          name: 'Llama 3.3 70B (free)',
          cost: { input: 0, output: 0 },
        },
      },
    },
  }

  it('normalizes rich fields', () => {
    const [sonnet] = normalizeModelsDev(payload)
    expect(sonnet).toMatchObject({
      id: 'anthropic/claude-sonnet-4.5',
      vendor: 'anthropic',
      reasoning: true,
      toolCall: true,
      structuredOutput: true,
      contextLength: 1_000_000,
      maxOutput: 64_000,
      cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      releaseDate: '2025-09-29',
      knowledge: '2025-07-31',
      openWeights: false,
    })
    expect(sonnet.inputModalities).toEqual(['text', 'image', 'pdf'])
  })

  it('excludes free models — they never route under ZDR (IMA-44)', () => {
    const models = normalizeModelsDev(payload)
    expect(models.map((m) => m.id)).toEqual(['anthropic/claude-sonnet-4.5'])
  })

  it('returns [] when the openrouter provider is missing', () => {
    expect(normalizeModelsDev({})).toEqual([])
  })
})

describe('normalizeOpenRouter', () => {
  const payload = {
    data: [
      {
        id: 'anthropic/claude-sonnet-4.5',
        name: 'Anthropic: Claude Sonnet 4.5',
        context_length: 1_000_000,
        architecture: {
          input_modalities: ['text', 'image'],
          output_modalities: ['text'],
        },
        pricing: { prompt: '0.000003', completion: '0.000015' },
        top_provider: { max_completion_tokens: 64_000 },
        supported_parameters: ['reasoning', 'tools', 'structured_outputs'],
      },
      {
        id: 'poolside/laguna-xs-2.1',
        pricing: { prompt: '0.0000002', completion: '0.0000006' },
        supported_parameters: [],
      },
      {
        id: 'meta-llama/llama-3.3-70b-instruct:free',
        pricing: { prompt: '0', completion: '0' },
        supported_parameters: [],
      },
    ],
  }

  it('converts per-token string pricing to per-1M numbers', () => {
    const [sonnet] = normalizeOpenRouter(payload)
    expect(sonnet.cost).toEqual({ input: 3, output: 15 })
  })

  it('derives capabilities from supported_parameters', () => {
    const [sonnet, laguna] = normalizeOpenRouter(payload)
    expect(sonnet.reasoning).toBe(true)
    expect(sonnet.toolCall).toBe(true)
    expect(sonnet.structuredOutput).toBe(true)
    expect(laguna.reasoning).toBe(false)
    // Absent evidence is "unknown", not "no".
    expect(laguna.structuredOutput).toBeNull()
  })

  it('marks fields the fallback cannot know as null', () => {
    const [sonnet] = normalizeOpenRouter(payload)
    expect(sonnet.releaseDate).toBeNull()
    expect(sonnet.knowledge).toBeNull()
    expect(sonnet.openWeights).toBeNull()
  })

  it('excludes free models — they never route under ZDR (IMA-44)', () => {
    const models = normalizeOpenRouter(payload)
    expect(models.map((m) => m.id)).toEqual([
      'anthropic/claude-sonnet-4.5',
      'poolside/laguna-xs-2.1',
    ])
  })
})
