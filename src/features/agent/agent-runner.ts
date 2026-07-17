/**
 * The agentic loop (IMA-6): LLM → tool calls → execute → repeat until the
 * model answers without tools, we hit the iteration ceiling, or the caller
 * aborts.
 *
 * Port of v1's agent_runner.dart with the same invariants:
 *  - max 10 iterations by default
 *  - reasoning_details preserved verbatim across turns (reasoning models
 *    refuse mid-conversation tool calls without them)
 *  - every tool error becomes a tool RESULT the model can react to, never a
 *    crashed loop
 *
 * Relocation constraint: this module never touches React, the DOM, or
 * storage. Inputs are data + a host-capability object; output is an event
 * stream plus the appended messages. Moving it server-side (IMA-17) is a
 * file move, not a rewrite.
 */

import { OpenRouterRequestError, streamCompletion } from './openrouter'
import type { AgentHost } from './tool'
import type { ToolRegistry } from './tool-registry'
import {
  type AgentEvent,
  type AssistantMessage,
  type ChatMessage,
  generateMessageId,
  type ToolCallRequest,
  type ToolResultMessage,
  toApiMessages,
} from './types'

export const DEFAULT_MAX_ITERATIONS = 10

export interface RunAgentOptions {
  apiKey: string
  model: string
  systemPrompt: string | null
  /** Full conversation so far, ending with the newest user message. */
  transcript: ChatMessage[]
  registry: ToolRegistry
  host: AgentHost
  maxIterations?: number
  signal?: AbortSignal
  onEvent: (event: AgentEvent) => void
  /**
   * Tool names the loop cannot execute itself and must hand back to the
   * client (IMA-17) — request_scan on the server loop. When a completion's
   * tool-call batch contains any of these, the runner executes every OTHER
   * call first (streaming their results), then emits one `client_action`
   * event per pending client-action call and stops with done reason
   * 'client-action'. The OpenAI protocol requires every tool_call_id in a
   * batch to be answered before the next completion: the server answers the
   * ones it can, the client answers the rest and re-invokes the turn.
   * Omitted/empty ⇒ classic behavior (client loop executes everything).
   */
  clientActionTools?: ReadonlySet<string>
  /**
   * Called after each completion that reported usage (IMA-16 #360). `usage.cost`
   * is the actual USD billed; `model` attributes spend per turn; `generationId`
   * (from the stream, may be null) is the dedupe key for recordSpend and the
   * lookup id for the /api/v1/generation cost fallback.
   */
  onUsage?: (
    usage: Record<string, unknown>,
    model: string,
    generationId: string | null,
  ) => void
  /** Test seam, passed through to the OpenRouter client. */
  fetchImpl?: typeof fetch
}

/**
 * Run the loop. Resolves with the messages it appended (assistant turns and
 * tool results, in order). The caller owns persisting them.
 */
export async function runAgent(
  options: RunAgentOptions,
): Promise<ChatMessage[]> {
  const {
    onEvent,
    registry,
    host,
    signal,
    maxIterations = DEFAULT_MAX_ITERATIONS,
    clientActionTools,
    onUsage,
  } = options

  const working: ChatMessage[] = [...options.transcript]
  const appended: ChatMessage[] = []
  const toolSchemas = registry.schemas

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    if (signal?.aborted) {
      onEvent({ type: 'done', reason: 'aborted' })
      return appended
    }

    onEvent({ type: 'status', label: 'Thinking' })
    const assistantId = generateMessageId()

    let completion: Awaited<ReturnType<typeof streamCompletion>>
    try {
      completion = await streamCompletion({
        apiKey: options.apiKey,
        model: options.model,
        messages: toApiMessages(options.systemPrompt, working),
        tools: toolSchemas.length > 0 ? toolSchemas : undefined,
        signal,
        fetchImpl: options.fetchImpl,
        onDelta: (delta) =>
          onEvent({ type: 'assistant-delta', messageId: assistantId, delta }),
      })
    } catch (err) {
      if (
        signal?.aborted ||
        (err instanceof Error && err.name === 'AbortError')
      ) {
        onEvent({ type: 'done', reason: 'aborted' })
        return appended
      }
      const authExpired =
        err instanceof OpenRouterRequestError && err.isAuthError
      onEvent({
        type: 'error',
        message:
          err instanceof Error ? err.message : 'Unexpected agent failure',
        authExpired,
      })
      onEvent({ type: 'done', reason: 'error' })
      return appended
    }

    // Report spend before anything can bail (IMA-17): usage arrives on the
    // final chunk regardless of whether tool calls follow. Pass the generation
    // id through so the endpoint can dedupe + run the cost fallback (IMA-16).
    if (onUsage && completion.usage)
      onUsage(completion.usage, options.model, completion.generationId)

    const assistant: AssistantMessage = {
      id: assistantId,
      role: 'assistant',
      content: completion.content,
      toolCalls:
        completion.toolCalls.length > 0 ? completion.toolCalls : undefined,
      reasoningDetails:
        completion.reasoningDetails.length > 0
          ? completion.reasoningDetails
          : undefined,
      at: Date.now(),
    }
    working.push(assistant)
    appended.push(assistant)
    onEvent({ type: 'assistant-message', message: assistant })

    if (completion.toolCalls.length === 0) {
      onEvent({ type: 'done', reason: 'complete' })
      return appended
    }

    // Split the batch: calls this loop can execute vs. calls that must go
    // back to the client (IMA-17). We run every server-executable call first
    // and stream its result, THEN hand the client-action calls back — the
    // OpenAI protocol needs every tool_call_id in a batch answered before the
    // next completion, so the client re-invokes the turn once it has the
    // scan result appended.
    const clientActions: ToolCallRequest[] = []
    for (const call of completion.toolCalls) {
      if (signal?.aborted) {
        onEvent({ type: 'done', reason: 'aborted' })
        return appended
      }
      if (clientActionTools?.has(call.name)) {
        clientActions.push(call)
        continue
      }
      const result = await executeToolCall(call, registry, host, onEvent)
      working.push(result)
      appended.push(result)
      onEvent({ type: 'tool-result', message: result })
    }

    if (clientActions.length > 0) {
      for (const call of clientActions) {
        onEvent({ type: 'client_action', call })
      }
      onEvent({ type: 'done', reason: 'client-action' })
      return appended
    }
  }

  onEvent({ type: 'done', reason: 'max-iterations' })
  return appended
}

async function executeToolCall(
  call: ToolCallRequest,
  registry: ToolRegistry,
  host: AgentHost,
  onEvent: (event: AgentEvent) => void,
): Promise<ToolResultMessage> {
  const tool = registry.get(call.name)
  const label = tool ? tool.statusLabel(call.arguments) : `Running ${call.name}`
  onEvent({ type: 'tool-start', call, label })
  onEvent({ type: 'status', label })

  let content: string
  let isError = false
  if (!tool) {
    content = `Error: tool "${call.name}" is not available. Use only the tools provided.`
    isError = true
  } else {
    try {
      content = await tool.execute(call.arguments, host)
    } catch (err) {
      content = `Error executing ${call.name}: ${
        err instanceof Error ? err.message : String(err)
      }`
      isError = true
    }
  }

  return {
    id: generateMessageId(),
    role: 'tool',
    toolCallId: call.id,
    toolName: call.name,
    content,
    isError,
    at: Date.now(),
  }
}
