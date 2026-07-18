import { describe, expect, it } from 'vitest'
import { VpicClient } from './vpic'

class MemoryCache {
  entries = new Map<string, { value: string; ttl: number }>()

  async get(key: string): Promise<string | null> {
    return this.entries.get(key)?.value ?? null
  }

  async set(key: string, value: string, ttl: number): Promise<void> {
    this.entries.set(key, { value, ttl })
  }
}

function fetchQueue(...responses: Array<Response | Error>) {
  const calls: string[] = []
  const queue = [...responses]
  const impl = (async (input: URL | RequestInfo) => {
    calls.push(String(input))
    const next = queue.length > 1 ? queue.shift() : queue[0]
    if (next instanceof Error) throw next
    if (!next) throw new Error('fetchQueue drained')
    return next
  }) as typeof fetch
  return { impl, calls }
}

function modelsResponse(...models: string[]): Response {
  return new Response(
    JSON.stringify({ Results: models.map((Model_Name) => ({ Model_Name })) }),
    { status: 200 },
  )
}

describe('VpicClient', () => {
  it('caches a make model list for 30 days and serves a later lookup from cache', async () => {
    const cache = new MemoryCache()
    const { impl, calls } = fetchQueue(modelsResponse('Civic', 'CR-V'))
    const client = new VpicClient({ fetchImpl: impl, cache })

    await client.identifyVehicle({ make: 'Honda', model: 'Civic' })
    const second = await client.identifyVehicle({ make: 'Honda', model: 'CR-V' })

    expect(second.matched).toBe(true)
    expect(calls).toHaveLength(1)
    expect(cache.entries.get('vpic:models:honda')).toEqual({
      value: JSON.stringify(['Civic', 'CR-V']),
      ttl: 30 * 24 * 60 * 60,
    })
  })

  it('matches models case-insensitively by either substring direction', async () => {
    const { impl } = fetchQueue(modelsResponse('Civic Sedan', 'Accord'))
    const result = await new VpicClient({ fetchImpl: impl }).identifyVehicle({
      make: 'Honda',
      model: 'civic',
    })

    expect(result).toMatchObject({ matched: true, candidates: [] })
  })

  it('returns close candidate names when a model does not match', async () => {
    const { impl } = fetchQueue(modelsResponse('Civic', 'Accord', 'Passport'))
    const result = await new VpicClient({ fetchImpl: impl }).identifyVehicle({
      make: 'Honda',
      model: 'Civix',
    })

    expect(result.matched).toBe(false)
    expect(result.candidates).toContain('Civic')
    expect(result.candidates.length).toBeLessThanOrEqual(5)
  })

  it('degrades gracefully when vPIC is unavailable', async () => {
    const { impl } = fetchQueue(new Error('network unavailable'))
    const result = await new VpicClient({ fetchImpl: impl }).identifyVehicle({
      make: 'Honda',
      model: 'Civic',
    })

    expect(result).toMatchObject({
      matched: false,
      candidates: [],
      error: 'Vehicle lookup is temporarily unavailable.',
    })
  })
})
