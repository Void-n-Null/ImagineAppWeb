import { describe, expect, it } from 'vitest'
import {
  applyStreamChunk,
  mergeReasoningDetail,
  OpenRouterRequestError,
  parseToolArguments,
  streamCompletion,
} from './openrouter'
import type { ReasoningDetail } from './types'

function sse(...events: (Record<string, unknown> | string)[]): string {
  return `${events
    .map((e) => (typeof e === 'string' ? e : `data: ${JSON.stringify(e)}`))
    .join('\n\n')}\n\n`
}

function chunk(delta: Record<string, unknown>, finish?: string) {
  return {
    choices: [{ delta, finish_reason: finish ?? null }],
  }
}

function fetchReturning(body: string, status = 200) {
  const requests: { body: Record<string, unknown> }[] = []
  const impl = (async (_input: URL | RequestInfo, init?: RequestInit) => {
    requests.push({
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    })
    return new Response(body, { status })
  }) as typeof fetch
  return { impl, requests }
}

describe('parseToolArguments', () => {
  it('parses valid JSON objects', () => {
    expect(parseToolArguments('{"query":"tv"}')).toEqual({ query: 'tv' })
  })

  it('returns {} for malformed JSON, arrays, and empty strings', () => {
    expect(parseToolArguments('{"broken')).toEqual({})
    expect(parseToolArguments('[1,2]')).toEqual({})
    expect(parseToolArguments('  ')).toEqual({})
  })
})

describe('applyStreamChunk', () => {
  function freshState() {
    return {
      content: [] as string[],
      toolCalls: new Map(),
      reasoning: new Map<number, ReasoningDetail>(),
      finishReason: null as string | null,
      usage: null as Record<string, unknown> | null,
      generationId: null as string | null,
    }
  }

  it('captures the generation id from chunk.id (last non-null wins)', () => {
    const state = freshState()
    applyStreamChunk({ id: 'gen_1', ...chunk({ content: 'a' }) }, state)
    expect(state.generationId).toBe('gen_1')
    // A later chunk without id must not clear it; a new id overrides.
    applyStreamChunk(chunk({ content: 'b' }), state)
    expect(state.generationId).toBe('gen_1')
    applyStreamChunk({ id: 'gen_2', choices: [] }, state)
    expect(state.generationId).toBe('gen_2')
  })

  it('accumulates split tool-call argument fragments by index', () => {
    const state = freshState()
    applyStreamChunk(
      chunk({
        tool_calls: [
          {
            index: 0,
            id: 'call_a',
            function: { name: 'search_products', arguments: '{"que' },
          },
        ],
      }),
      state,
    )
    applyStreamChunk(
      chunk({
        tool_calls: [{ index: 0, function: { arguments: 'ry":"tv"}' } }],
      }),
      state,
    )
    const acc = state.toolCalls.get(0)
    expect(acc).toMatchObject({
      id: 'call_a',
      name: 'search_products',
      argumentsJson: '{"query":"tv"}',
    })
  })

  it('throws OpenRouterRequestError on mid-stream error events', () => {
    const state = freshState()
    expect(() =>
      applyStreamChunk({ error: { message: 'boom', code: 502 } }, state),
    ).toThrow(OpenRouterRequestError)
  })

  it('captures usage from the final chunk (empty choices)', () => {
    const state = freshState()
    // A normal content chunk carries no usage.
    applyStreamChunk(chunk({ content: 'hi' }, 'stop'), state)
    expect(state.usage).toBeNull()
    // The final usage chunk typically has empty choices.
    applyStreamChunk(
      { choices: [], usage: { cost: 0.0042, total_tokens: 17 } },
      state,
    )
    expect(state.usage).toEqual({ cost: 0.0042, total_tokens: 17 })
  })
})

describe('mergeReasoningDetail', () => {
  it('concatenates text fragments for the same index and keeps metadata', () => {
    const acc = new Map<number, ReasoningDetail>()
    mergeReasoningDetail(
      acc,
      { index: 0, type: 'reasoning.text', text: 'thinking ' },
      0,
    )
    mergeReasoningDetail(
      acc,
      { index: 0, type: 'reasoning.text', text: 'hard', signature: 'sig' },
      1,
    )
    expect(acc.get(0)).toEqual({
      type: 'reasoning.text',
      text: 'thinking hard',
      signature: 'sig',
    })
  })
})

describe('streamCompletion', () => {
  it('accumulates content deltas and reports them via onDelta', async () => {
    const body = sse(
      ': OPENROUTER PROCESSING',
      chunk({ role: 'assistant', content: 'Hel' }),
      chunk({ content: 'lo' }, 'stop'),
      'data: [DONE]',
    )
    const { impl } = fetchReturning(body)
    const deltas: string[] = []
    const result = await streamCompletion({
      apiKey: 'k',
      model: 'test/model',
      messages: [{ role: 'user', content: 'hi' }],
      fetchImpl: impl,
      onDelta: (d) => deltas.push(d),
    })
    expect(result.content).toBe('Hello')
    expect(deltas).toEqual(['Hel', 'lo'])
    expect(result.finishReason).toBe('stop')
    expect(result.toolCalls).toEqual([])
  })

  it('assembles tool calls and preserves reasoning details', async () => {
    const body = sse(
      chunk({
        reasoning_details: [
          { index: 0, type: 'reasoning.text', text: 'let me ' },
        ],
      }),
      chunk({
        reasoning_details: [
          { index: 0, type: 'reasoning.text', text: 'search' },
        ],
        tool_calls: [
          {
            index: 0,
            id: 'call_1',
            function: { name: 'search_products', arguments: '{"query":' },
          },
        ],
      }),
      chunk(
        { tool_calls: [{ index: 0, function: { arguments: '"tv"}' } }] },
        'tool_calls',
      ),
      'data: [DONE]',
    )
    const { impl, requests } = fetchReturning(body)
    const result = await streamCompletion({
      apiKey: 'k',
      model: 'test/model',
      messages: [],
      tools: [{ type: 'function' }],
      fetchImpl: impl,
    })
    expect(result.toolCalls).toEqual([
      {
        id: 'call_1',
        name: 'search_products',
        argumentsJson: '{"query":"tv"}',
        arguments: { query: 'tv' },
      },
    ])
    expect(result.reasoningDetails).toEqual([
      { type: 'reasoning.text', text: 'let me search' },
    ])
    expect(requests[0]?.body.stream).toBe(true)
    expect(requests[0]?.body.tools).toEqual([{ type: 'function' }])
  })

  it('opts into prompt caching for Anthropic models only (IMA-28)', async () => {
    const body = sse(chunk({ content: 'ok' }, 'stop'), 'data: [DONE]')

    const anthropic = fetchReturning(body)
    await streamCompletion({
      apiKey: 'k',
      model: 'anthropic/claude-sonnet-5',
      messages: [],
      fetchImpl: anthropic.impl,
    })
    expect(anthropic.requests[0]?.body.cache_control).toEqual({
      type: 'ephemeral',
    })

    const gemini = fetchReturning(body)
    await streamCompletion({
      apiKey: 'k',
      model: 'google/gemini-3.1-flash-lite',
      messages: [],
      fetchImpl: gemini.impl,
    })
    expect(gemini.requests[0]?.body).not.toHaveProperty('cache_control')
  })

  it('restricts every request to no-retention / no-training providers (Best Buy ToS)', async () => {
    const body = sse(chunk({ content: 'ok' }, 'stop'), 'data: [DONE]')
    const { impl, requests } = fetchReturning(body)
    await streamCompletion({
      apiKey: 'k',
      model: 'test/model',
      messages: [],
      fetchImpl: impl,
    })
    // Best Buy Content must not be retained or trained on by the provider:
    // deny data collection AND require Zero Data Retention endpoints.
    expect(requests[0]?.body.provider).toEqual({
      data_collection: 'deny',
      zdr: true,
    })
  })

  it('requests usage accounting and surfaces it on the result (IMA-17)', async () => {
    const body = sse(
      chunk({ content: 'ok' }, 'stop'),
      { choices: [], usage: { cost: 0.007, total_tokens: 12 } },
      'data: [DONE]',
    )
    const { impl, requests } = fetchReturning(body)
    const result = await streamCompletion({
      apiKey: 'k',
      model: 'test/model',
      messages: [],
      fetchImpl: impl,
    })
    expect(requests[0]?.body.usage).toEqual({ include: true })
    expect(result.usage).toEqual({ cost: 0.007, total_tokens: 12 })
  })

  it('surfaces the generation id on the result (IMA-16 #360)', async () => {
    const body = sse(
      { id: 'gen_xyz', ...chunk({ content: 'ok' }, 'stop') },
      { id: 'gen_xyz', choices: [], usage: { cost: 0.007 } },
      'data: [DONE]',
    )
    const { impl } = fetchReturning(body)
    const result = await streamCompletion({
      apiKey: 'k',
      model: 'test/model',
      messages: [],
      fetchImpl: impl,
    })
    expect(result.generationId).toBe('gen_xyz')
  })

  it('leaves usage null when the provider reports none', async () => {
    const body = sse(chunk({ content: 'ok' }, 'stop'), 'data: [DONE]')
    const { impl } = fetchReturning(body)
    const result = await streamCompletion({
      apiKey: 'k',
      model: 'test/model',
      messages: [],
      fetchImpl: impl,
    })
    expect(result.usage).toBeNull()
  })

  it('maps HTTP errors to OpenRouterRequestError with status', async () => {
    const { impl } = fetchReturning(
      JSON.stringify({ error: { message: 'bad key' } }),
      401,
    )
    await expect(
      streamCompletion({
        apiKey: 'k',
        model: 'm',
        messages: [],
        fetchImpl: impl,
      }),
    ).rejects.toMatchObject({ status: 401, message: 'bad key' })
  })
})
