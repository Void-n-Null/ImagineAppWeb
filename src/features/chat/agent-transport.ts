/**
 * The turn transport (IMA-17 Phase 2), extracted from useAgentChat so the
 * POST → SSE → apply → client-action-re-invoke loop is unit-testable without
 * a React renderer. The hook wires this to state via the {@link TurnSink}
 * callbacks; tests wire it to spies + scripted fetch responses.
 *
 * The loop:
 *  1. POST the current transcript to /api/agent/turn.
 *  2. Stream the SSE TurnEvents, routing each to the sink.
 *  3. If the turn ended with pending `client_action` (request_scan) calls,
 *     run each via the host, append the tool result, and re-POST — capped at
 *     MAX_CLIENT_ACTION_ROUNDS consecutive rounds to bound pool-key spend.
 */

import {
  type AgentHost,
  type ChatMessage,
  generateMessageId,
  readTurnEventStream,
  requestScanTool,
  type ToolCallRequest,
  type ToolResultMessage,
  type TurnEvent,
  type TurnRequestBody,
} from '#/features/agent'
import type { CartItem } from '#/features/cart/cart-store'

/** The turn endpoint. */
export const TURN_ENDPOINT = '/api/agent/turn'

/**
 * Max consecutive client-action (scan) round-trips per send before we stop
 * and surface an error. Each round is a full turn re-POST; without a ceiling a
 * model that keeps asking to scan could loop forever on the pool key.
 */
export const MAX_CLIENT_ACTION_ROUNDS = 3

export interface ChatNotice {
  kind: 'error' | 'limit'
  message: string
  authExpired: boolean
}

/**
 * The side effects the transport performs, injected so the hook binds them to
 * React state and tests bind them to spies. `getTranscript` reads the live
 * transcript (the transport appends to it via `append`, so a re-POST sees the
 * scan result it just added).
 */
export interface TurnSink {
  getTranscript(): ChatMessage[]
  append(message: ChatMessage): void
  setActivity(label: string | null): void
  setDraft(
    update: (
      prev: { id: string; text: string } | null,
    ) => { id: string; text: string } | null,
  ): void
  setNotice(notice: ChatNotice): void
  applyCart(event: Extract<TurnEvent, { type: 'cart' }>): void
  host: AgentHost
  /** Selected model id for the request body. */
  model: string
  /** Whether the selected model gets tools (server builds its own registry). */
  toolsEnabled: boolean
  /**
   * Read the device cart for the turn request. A getter, not a snapshot, so a
   * re-POST after a cart mutation (server cart events, applied via applyCart)
   * sends the up-to-date cart.
   */
  getCart(): CartItem[]
  /** Observe streamed events without changing how the transport applies them. */
  onEvent?: (event: TurnEvent) => void
  /** Test seam. */
  fetchImpl?: typeof fetch
}

/** Build the untrusted turn request body from the current transcript + sink. */
function buildRequestBody(sink: TurnSink): TurnRequestBody {
  return {
    messages: sink.getTranscript(),
    model: sink.model,
    toolsEnabled: sink.toolsEnabled,
    cart: sink.getCart(),
    clock: {
      iso: new Date().toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  }
}

/** Map a non-2xx (or bodyless) response to the right notice. */
async function applyErrorResponse(
  response: Response,
  sink: TurnSink,
): Promise<void> {
  let payload: Record<string, unknown> = {}
  try {
    payload = (await response.json()) as Record<string, unknown>
  } catch {
    // Non-JSON error body — fall through to a generic message.
  }

  if (response.status === 401) {
    // BYOK reauth is dead here (server pool key) — never authExpired.
    sink.setNotice({
      kind: 'error',
      message: 'Sign in to keep chatting.',
      authExpired: false,
    })
    return
  }

  if (response.status === 429) {
    const retry =
      typeof payload.retryAfterSeconds === 'number'
        ? Math.ceil(payload.retryAfterSeconds)
        : null
    sink.setNotice({
      kind: 'limit',
      message: retry
        ? `You're going fast — try again in ${retry}s.`
        : "You're going fast — give it a moment and try again.",
      authExpired: false,
    })
    return
  }

  if (response.status === 402) {
    // Out of credits (IMA-16 #366). The server tags WHY: an empty wallet
    // (grant spent) vs. the waitlist (no grant yet). Both are 'limit'
    // notices so they render calm, not alarming.
    const waitlisted = payload.error === 'waitlisted'
    sink.setNotice({
      kind: 'limit',
      message: waitlisted
        ? "You're on the waitlist — you'll get credits when the pool refills."
        : 'Out of credits — top-ups land soon.',
      authExpired: false,
    })
    return
  }

  // 400 / 500 / anything else: prefer the server's message when present.
  const message =
    typeof payload.message === 'string' && payload.message.length > 0
      ? payload.message
      : 'Something went wrong — ask again.'
  sink.setNotice({ kind: 'error', message, authExpired: false })
}

/**
 * Run one server turn. POSTs the transcript, streams the events into the sink,
 * and returns the pending client-action calls (empty when the turn completed
 * or errored). Throws on a transport-level drop the caller must surface.
 */
export async function runTurn(
  sink: TurnSink,
  signal: AbortSignal,
): Promise<ToolCallRequest[]> {
  const doFetch = sink.fetchImpl ?? fetch
  const response = await doFetch(TURN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildRequestBody(sink)),
    signal,
  })

  if (!response.ok || !response.body) {
    await applyErrorResponse(response, sink)
    return []
  }

  const clientActions: ToolCallRequest[] = []
  await readTurnEventStream(response.body, (event) => {
    sink.onEvent?.(event)
    switch (event.type) {
      case 'status':
        sink.setActivity(event.label)
        break
      case 'assistant-delta':
        sink.setDraft((prev) =>
          prev && prev.id === event.messageId
            ? { id: prev.id, text: prev.text + event.delta }
            : { id: event.messageId, text: event.delta },
        )
        break
      case 'assistant-message':
        sink.setDraft(() => null)
        sink.append(event.message)
        break
      case 'tool-result':
        sink.append(event.message)
        break
      case 'tool-start':
        break
      case 'cart':
        sink.applyCart(event)
        break
      case 'client_action':
        clientActions.push(event.call)
        break
      case 'error':
        sink.setNotice({
          kind: 'error',
          message: event.message,
          authExpired: false,
        })
        break
      case 'done':
        if (event.reason === 'max-iterations') {
          sink.setNotice({
            kind: 'limit',
            message:
              'Hit the 10-step limit for one request. Ask again or simplify.',
            authExpired: false,
          })
        }
        break
    }
  })

  return clientActions
}

/**
 * Execute one pending client-action (request_scan) via the host and turn its
 * result into a ToolResultMessage, exactly as request_scan's own tool.execute
 * does — reusing that tool so there is one code path for the scan handoff.
 */
async function runClientAction(
  call: ToolCallRequest,
  host: AgentHost,
): Promise<ToolResultMessage> {
  const content = await requestScanTool.execute(call.arguments, host)
  return {
    id: generateMessageId(),
    role: 'tool',
    toolCallId: call.id,
    toolName: 'request_scan',
    content,
    isError: false,
    at: Date.now(),
  }
}

/**
 * Drive a send to completion across any client-action round-trips. Runs turns
 * until one completes without pending scans, the round cap is hit, or a
 * transport drop occurs. Never throws — every failure becomes a sink notice;
 * an intentional abort (stop()/unmount) is silent.
 */
export async function driveTurns(
  sink: TurnSink,
  signal: AbortSignal,
): Promise<void> {
  try {
    for (let round = 0; round <= MAX_CLIENT_ACTION_ROUNDS; round++) {
      const clientActions = await runTurn(sink, signal)
      if (clientActions.length === 0) return // completed or errored

      if (round === MAX_CLIENT_ACTION_ROUNDS) {
        sink.setNotice({
          kind: 'error',
          message:
            'Too many scan steps in a row — ask again or type the details.',
          authExpired: false,
        })
        return
      }

      // Answer every pending scan before re-POSTing: the OpenAI protocol needs
      // every tool_call_id in the batch answered before the next completion.
      for (const call of clientActions) {
        sink.append(await runClientAction(call, sink.host))
      }
    }
  } catch {
    if (signal.aborted) return // stop()/unmount — not an error to surface
    // A network drop mid-turn: the stream died before a clean done.
    sink.setNotice({
      kind: 'error',
      message: 'Connection lost mid-answer — ask again.',
      authExpired: false,
    })
  }
}
