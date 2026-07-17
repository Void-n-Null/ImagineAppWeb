import { describe, expect, it } from 'vitest'
import { runAgent } from './agent-runner'
import type { AgentHost, AgentTool } from './tool'
import { ToolRegistry } from './tool-registry'
import type { AgentEvent } from './types'
import { userMessage } from './types'

const host: AgentHost = {
  requestScan: () => Promise.resolve({ status: 'cancelled' as const }),
  cart: {
    items: () => [],
    add: () => {},
    remove: () => null,
    clear: () => 0,
  },
  clock: () => ({ iso: '2026-07-07T12:00:00.000Z', timeZone: 'UTC' }),
}

function sseBody(
  events: Record<string, unknown>[],
  finish: string | null,
): string {
  const frames: Record<string, unknown>[] = events.map((delta) => ({
    choices: [{ delta, finish_reason: null }],
  }))
  frames.push({ choices: [{ delta: {}, finish_reason: finish }] })
  return `${frames.map((f) => `data: ${JSON.stringify(f)}`).join('\n\n')}\n\ndata: [DONE]\n\n`
}

/** Assistant turn that calls one tool. */
function toolCallTurn(name: string, args: Record<string, unknown>): string {
  return sseBody(
    [
      {
        tool_calls: [
          {
            index: 0,
            id: 'call_1',
            function: { name, arguments: JSON.stringify(args) },
          },
        ],
        reasoning_details: [{ type: 'reasoning.text', text: 'hmm' }],
      },
    ],
    'tool_calls',
  )
}

function textTurn(text: string): string {
  return sseBody([{ content: text }], 'stop')
}

function fetchQueue(...bodies: string[]) {
  const requests: Record<string, unknown>[] = []
  const queue = [...bodies]
  const impl = (async (_input: URL | RequestInfo, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
    const next = queue.shift()
    if (!next) throw new Error('fetchQueue drained')
    return new Response(next, { status: 200 })
  }) as typeof fetch
  return { impl, requests }
}

function echoTool(log: Record<string, unknown>[]): AgentTool {
  return {
    name: 'echo',
    description: 'echo',
    parameters: { type: 'object', properties: {} },
    statusLabel: () => 'Echoing',
    execute: (args) => {
      log.push(args)
      return Promise.resolve(`echo:${JSON.stringify(args)}`)
    },
  }
}

async function run(
  fetchImpl: typeof fetch,
  registry: ToolRegistry,
  maxIterations = 10,
  extra?: Partial<Parameters<typeof runAgent>[0]>,
) {
  const events: AgentEvent[] = []
  const appended = await runAgent({
    apiKey: 'k',
    model: 'test/model',
    systemPrompt: 'be brief',
    transcript: [userMessage('hi')],
    registry,
    host,
    maxIterations,
    onEvent: (e) => events.push(e),
    fetchImpl,
    ...extra,
  })
  return { events, appended }
}

/** Assistant turn that calls two tools in one batch (indices 0 and 1). */
function twoToolCallTurn(
  a: { name: string; args: Record<string, unknown> },
  b: { name: string; args: Record<string, unknown> },
): string {
  return sseBody(
    [
      {
        tool_calls: [
          {
            index: 0,
            id: 'call_a',
            function: { name: a.name, arguments: JSON.stringify(a.args) },
          },
          {
            index: 1,
            id: 'call_b',
            function: { name: b.name, arguments: JSON.stringify(b.args) },
          },
        ],
      },
    ],
    'tool_calls',
  )
}

describe('runAgent', () => {
  it('answers directly when the model returns no tool calls', async () => {
    const { impl, requests } = fetchQueue(textTurn('Hello!'))
    const { events, appended } = await run(impl, new ToolRegistry())

    expect(appended).toHaveLength(1)
    expect(appended[0]).toMatchObject({ role: 'assistant', content: 'Hello!' })
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'complete' })
    // System prompt goes first on the wire.
    const messages = requests[0]?.messages as Record<string, unknown>[]
    expect(messages[0]).toEqual({ role: 'system', content: 'be brief' })
  })

  it('executes tool calls and feeds results (and reasoning) back to the model', async () => {
    const toolLog: Record<string, unknown>[] = []
    const { impl, requests } = fetchQueue(
      toolCallTurn('echo', { q: 'tv' }),
      textTurn('Done'),
    )
    const { events, appended } = await run(
      impl,
      new ToolRegistry([echoTool(toolLog)]),
    )

    expect(toolLog).toEqual([{ q: 'tv' }])
    expect(appended.map((m) => m.role)).toEqual([
      'assistant',
      'tool',
      'assistant',
    ])

    // Second request must carry the assistant tool_calls turn, the verbatim
    // reasoning_details, and the tool result.
    const second = requests[1]?.messages as Record<string, unknown>[]
    const assistantTurn = second.at(-2)
    const toolTurn = second.at(-1)
    expect(assistantTurn).toMatchObject({
      role: 'assistant',
      reasoning_details: [{ type: 'reasoning.text', text: 'hmm' }],
    })
    expect(toolTurn).toMatchObject({
      role: 'tool',
      tool_call_id: 'call_1',
      content: 'echo:{"q":"tv"}',
    })

    const types = events.map((e) => e.type)
    expect(types).toContain('tool-start')
    expect(types).toContain('tool-result')
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'complete' })
  })

  it('turns unknown tools into error results the model can react to', async () => {
    const { impl } = fetchQueue(toolCallTurn('nope', {}), textTurn('ok'))
    const { appended } = await run(impl, new ToolRegistry())
    const toolResult = appended.find((m) => m.role === 'tool')
    expect(toolResult).toMatchObject({
      isError: true,
      content: expect.stringContaining('not available'),
    })
  })

  it('stops at the iteration ceiling', async () => {
    const toolLog: Record<string, unknown>[] = []
    const bodies = [
      toolCallTurn('echo', {}),
      toolCallTurn('echo', {}),
      toolCallTurn('echo', {}),
    ]
    const { impl } = fetchQueue(...bodies)
    const { events } = await run(impl, new ToolRegistry([echoTool(toolLog)]), 3)
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'max-iterations' })
    expect(toolLog).toHaveLength(3)
  })

  it('client-action calls: runs server tools first, then hands the action back', async () => {
    // A mixed batch: echo (server-executable) + request_scan (client-action).
    // The runner must execute echo, stream its result, then emit one
    // client_action for request_scan and stop with reason 'client-action'.
    const toolLog: Record<string, unknown>[] = []
    const { impl } = fetchQueue(
      twoToolCallTurn(
        { name: 'echo', args: { q: 'tv' } },
        { name: 'request_scan', args: { product_name: 'the cable' } },
      ),
    )
    const { events, appended } = await run(
      impl,
      new ToolRegistry([echoTool(toolLog)]),
      10,
      { clientActionTools: new Set(['request_scan']) },
    )

    // echo ran; request_scan did NOT (no fetchQueue drain, one completion).
    expect(toolLog).toEqual([{ q: 'tv' }])
    // Appended: the assistant turn + the echo tool result (no scan result).
    expect(appended.map((m) => m.role)).toEqual(['assistant', 'tool'])

    // Ordering: the echo tool-result is streamed BEFORE the client_action.
    const toolResultIdx = events.findIndex((e) => e.type === 'tool-result')
    const clientActionIdx = events.findIndex((e) => e.type === 'client_action')
    expect(toolResultIdx).toBeGreaterThanOrEqual(0)
    expect(clientActionIdx).toBeGreaterThan(toolResultIdx)

    const clientAction = events[clientActionIdx]
    expect(clientAction).toMatchObject({
      type: 'client_action',
      call: { name: 'request_scan', id: 'call_b' },
    })
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'client-action' })
  })

  it('emits one client_action per pending client-action call', async () => {
    const { impl } = fetchQueue(
      twoToolCallTurn(
        { name: 'request_scan', args: { product_name: 'a' } },
        { name: 'request_scan', args: { product_name: 'b' } },
      ),
    )
    const { events } = await run(impl, new ToolRegistry(), 10, {
      clientActionTools: new Set(['request_scan']),
    })
    const actions = events.filter((e) => e.type === 'client_action')
    expect(actions).toHaveLength(2)
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'client-action' })
  })

  it('is unaffected when a batch has no client-action calls', async () => {
    const toolLog: Record<string, unknown>[] = []
    const { impl } = fetchQueue(
      toolCallTurn('echo', { q: 'x' }),
      textTurn('ok'),
    )
    const { events } = await run(
      impl,
      new ToolRegistry([echoTool(toolLog)]),
      10,
      {
        clientActionTools: new Set(['request_scan']),
      },
    )
    expect(events.some((e) => e.type === 'client_action')).toBe(false)
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'complete' })
  })

  it('invokes onUsage with the reported usage, model, and generation id', async () => {
    // The final chunk carries usage; the runner reports it once per completion.
    // The generation id rides on every chunk's `id` (last non-null wins).
    const withUsage = `data: ${JSON.stringify({
      id: 'gen_abc123',
      choices: [{ delta: { content: 'hi' }, finish_reason: 'stop' }],
    })}\n\ndata: ${JSON.stringify({
      id: 'gen_abc123',
      choices: [],
      usage: { cost: 0.0123, total_tokens: 42 },
    })}\n\ndata: [DONE]\n\n`
    const impl = (async () =>
      new Response(withUsage, { status: 200 })) as typeof fetch
    const usageCalls: {
      usage: Record<string, unknown>
      model: string
      generationId: string | null
    }[] = []
    await run(impl, new ToolRegistry(), 10, {
      onUsage: (usage, model, generationId) =>
        usageCalls.push({ usage, model, generationId }),
    })
    expect(usageCalls).toEqual([
      {
        usage: { cost: 0.0123, total_tokens: 42 },
        model: 'test/model',
        generationId: 'gen_abc123',
      },
    ])
  })

  it('reports auth errors with authExpired so the UI can force reconnect', async () => {
    const impl = (async () =>
      new Response(JSON.stringify({ error: { message: 'expired' } }), {
        status: 401,
      })) as typeof fetch
    const { events } = await run(impl, new ToolRegistry())
    expect(events).toContainEqual({
      type: 'error',
      message: 'expired',
      authExpired: true,
    })
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'error' })
  })
})
