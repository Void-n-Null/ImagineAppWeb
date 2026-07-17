import { describe, expect, it, vi } from 'vitest'
import type { AgentHost, ChatMessage, TurnEvent } from '#/features/agent'
import type { CartItem } from '#/features/cart/cart-store'
import {
  type ChatNotice,
  driveTurns,
  MAX_CLIENT_ACTION_ROUNDS,
  runTurn,
  type TurnSink,
} from './agent-transport'

/** A ReadableStream body of SSE frames for the given events. */
function sseBody(events: TurnEvent[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const text = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text))
      controller.close()
    },
  })
}

function okResponse(events: TurnEvent[]): Response {
  return new Response(sseBody(events), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

/** A host whose requestScan resolves to a fixed outcome. */
function scanHost(): AgentHost {
  return {
    requestScan: vi.fn(async () => ({ status: 'cancelled' as const })),
    cart: {
      items: () => [],
      add: () => {},
      remove: () => null,
      clear: () => 0,
    },
    clock: () => ({ iso: '2026-07-07T00:00:00.000Z', timeZone: 'UTC' }),
  }
}

/** A sink backed by a mutable transcript array + captured notices/carts. */
function makeSink(overrides: Partial<TurnSink> = {}) {
  const transcript: ChatMessage[] = []
  const notices: ChatNotice[] = []
  const cartEvents: Extract<TurnEvent, { type: 'cart' }>[] = []
  const sink: TurnSink = {
    getTranscript: () => transcript,
    append: (m) => transcript.push(m),
    setActivity: () => {},
    setDraft: () => {},
    setNotice: (n) => notices.push(n),
    applyCart: (e) => cartEvents.push(e),
    host: scanHost(),
    model: 'anthropic/claude-sonnet-5',
    toolsEnabled: true,
    getCart: () => [],
    ...overrides,
  }
  return { sink, transcript, notices, cartEvents }
}

const abort = () => new AbortController().signal

describe('runTurn — SSE application', () => {
  it('appends assistant + tool-result messages from the stream', async () => {
    const fetchImpl = vi.fn(async () =>
      okResponse([
        { type: 'status', label: 'Thinking' },
        {
          type: 'assistant-message',
          message: {
            id: 'a1',
            role: 'assistant',
            content: 'Here you go',
            at: 1,
          },
        },
        { type: 'done', reason: 'complete' },
      ]),
    ) as unknown as typeof fetch
    const { sink, transcript } = makeSink({ fetchImpl })

    const pending = await runTurn(sink, abort())
    expect(pending).toEqual([])
    expect(transcript.map((m) => m.role)).toEqual(['assistant'])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('applies cart events to the sink', async () => {
    const item: CartItem = {
      sku: 42,
      name: 'TV',
      price: 499,
      manufacturer: null,
      modelNumber: null,
      upc: null,
      image: null,
      addedAt: 0,
    }
    const fetchImpl = vi.fn(async () =>
      okResponse([
        { type: 'cart', op: 'add', item },
        { type: 'cart', op: 'remove', sku: 7 },
        { type: 'cart', op: 'clear' },
        { type: 'done', reason: 'complete' },
      ]),
    ) as unknown as typeof fetch
    const { sink, cartEvents } = makeSink({ fetchImpl })

    await runTurn(sink, abort())
    expect(cartEvents).toEqual([
      { type: 'cart', op: 'add', item },
      { type: 'cart', op: 'remove', sku: 7 },
      { type: 'cart', op: 'clear' },
    ])
  })

  it('returns client_action calls instead of applying them', async () => {
    const call = {
      id: 'call_1',
      name: 'request_scan',
      argumentsJson: '{"product_name":"the cable"}',
      arguments: { product_name: 'the cable' },
    }
    const fetchImpl = vi.fn(async () =>
      okResponse([
        { type: 'client_action', call },
        { type: 'done', reason: 'client-action' },
      ]),
    ) as unknown as typeof fetch
    const { sink } = makeSink({ fetchImpl })

    const pending = await runTurn(sink, abort())
    expect(pending).toEqual([call])
  })
})

describe('runTurn — error responses', () => {
  it('401 → sign-in notice (never authExpired)', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'sign_in_required' }), {
          status: 401,
        }),
    ) as unknown as typeof fetch
    const { sink, notices } = makeSink({ fetchImpl })
    await runTurn(sink, abort())
    expect(notices).toEqual([
      {
        kind: 'error',
        message: 'Sign in to keep chatting.',
        authExpired: false,
      },
    ])
  })

  it('429 → limit notice with retry seconds', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ error: 'rate_limited', retryAfterSeconds: 12 }),
          { status: 429 },
        ),
    ) as unknown as typeof fetch
    const { sink, notices } = makeSink({ fetchImpl })
    await runTurn(sink, abort())
    expect(notices[0].kind).toBe('limit')
    expect(notices[0].message).toContain('12s')
  })

  it('402 empty_wallet → out-of-credits limit notice', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'empty_wallet' }), {
          status: 402,
        }),
    ) as unknown as typeof fetch
    const { sink, notices } = makeSink({ fetchImpl })
    await runTurn(sink, abort())
    expect(notices).toEqual([
      {
        kind: 'limit',
        message: 'Out of credits — top-ups land soon.',
        authExpired: false,
      },
    ])
  })

  it('402 waitlisted → waitlist limit notice', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'waitlisted' }), {
          status: 402,
        }),
    ) as unknown as typeof fetch
    const { sink, notices } = makeSink({ fetchImpl })
    await runTurn(sink, abort())
    expect(notices).toEqual([
      {
        kind: 'limit',
        message:
          "You're on the waitlist — you'll get credits when the pool refills.",
        authExpired: false,
      },
    ])
  })

  it('400 → surfaces the server message', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: 'invalid_request',
            message: 'model too long',
          }),
          { status: 400 },
        ),
    ) as unknown as typeof fetch
    const { sink, notices } = makeSink({ fetchImpl })
    await runTurn(sink, abort())
    expect(notices[0]).toMatchObject({
      kind: 'error',
      message: 'model too long',
    })
  })
})

describe('driveTurns — client-action re-invoke', () => {
  const scanCall = {
    id: 'call_1',
    name: 'request_scan',
    argumentsJson: '{"product_name":"the cable"}',
    arguments: { product_name: 'the cable' },
  }

  it('runs the scan, appends the tool result, and re-POSTs the turn', async () => {
    const fetchMock = vi
      .fn()
      // Turn 1: hand back a scan client-action.
      .mockResolvedValueOnce(
        okResponse([
          { type: 'client_action', call: scanCall },
          { type: 'done', reason: 'client-action' },
        ]),
      )
      // Turn 2 (after the scan result was appended): a normal answer.
      .mockResolvedValueOnce(
        okResponse([
          {
            type: 'assistant-message',
            message: {
              id: 'a2',
              role: 'assistant',
              content: 'It is a USB-C cable.',
              at: 2,
            },
          },
          { type: 'done', reason: 'complete' },
        ]),
      )
    const fetchImpl = fetchMock as unknown as typeof fetch

    const { sink, transcript } = makeSink({ fetchImpl })
    await driveTurns(sink, abort())

    // Two POSTs fired (initial + re-invoke).
    expect(fetchMock).toHaveBeenCalledTimes(2)
    // Transcript: scan tool result, then the follow-up assistant message.
    const scanResult = transcript.find(
      (m) => m.role === 'tool' && m.toolName === 'request_scan',
    )
    expect(scanResult).toBeDefined()
    expect(scanResult).toMatchObject({ toolCallId: 'call_1', role: 'tool' })
    // The second POST body carried the appended scan result.
    const secondBody = JSON.parse(
      (fetchMock.mock.calls[1][1] as RequestInit).body as string,
    )
    expect(
      (secondBody.messages as ChatMessage[]).some(
        (m) => m.role === 'tool' && m.toolName === 'request_scan',
      ),
    ).toBe(true)
    // And the conversation ends with the model's follow-up.
    expect(transcript.at(-1)).toMatchObject({ role: 'assistant' })
  })

  it('guards against runaway scans: stops after MAX_CLIENT_ACTION_ROUNDS', async () => {
    // Every turn keeps handing back a scan — the guard must break the loop.
    const fetchImpl = vi.fn(async () =>
      okResponse([
        { type: 'client_action', call: scanCall },
        { type: 'done', reason: 'client-action' },
      ]),
    ) as unknown as typeof fetch

    const { sink, notices } = makeSink({ fetchImpl })
    await driveTurns(sink, abort())

    // MAX_CLIENT_ACTION_ROUNDS + 1 total POSTs (rounds 0..MAX inclusive),
    // then it bails with an error notice rather than looping forever.
    expect(fetchImpl).toHaveBeenCalledTimes(MAX_CLIENT_ACTION_ROUNDS + 1)
    expect(notices.at(-1)).toMatchObject({
      kind: 'error',
      message: expect.stringContaining('Too many scan steps'),
    })
  })
})

describe('driveTurns — transport drop', () => {
  it('surfaces a lost-connection notice when the stream errors mid-turn', async () => {
    const fetchImpl = vi.fn(async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new Error('network gone'))
        },
      })
      return new Response(body, { status: 200 })
    }) as unknown as typeof fetch

    const { sink, notices } = makeSink({ fetchImpl })
    await driveTurns(sink, abort())
    expect(notices.at(-1)).toMatchObject({
      kind: 'error',
      message: 'Connection lost mid-answer — ask again.',
    })
  })

  it('stays silent when the abort was intentional', async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn(async () => {
      controller.abort()
      throw new DOMException('aborted', 'AbortError')
    }) as unknown as typeof fetch

    const { sink, notices } = makeSink({ fetchImpl })
    await driveTurns(sink, controller.signal)
    expect(notices).toEqual([])
  })
})
