/**
 * Minimal streaming client for OpenRouter /chat/completions (IMA-6).
 *
 * Hand-rolled fetch + SSE, zero-SDK by design. Browser CORS is supported by
 * OpenRouter, so this module is plain fetch/streams; it now runs inside the
 * server turn loop on the app's pool key (IMA-17).
 *
 * Accumulates three things from deltas:
 *  - assistant text (`delta.content`) — surfaced incrementally via onDelta
 *  - tool calls (`delta.tool_calls`, index-keyed argument fragments)
 *  - reasoning blocks (`delta.reasoning_details`, index-keyed) — preserved
 *    verbatim for echo-back; dropping these breaks multi-turn tool calling
 *    on reasoning models (v1: agent_runner.dart:104-110).
 */

import type { ReasoningDetail, ToolCallRequest } from './types'

export const OPENROUTER_COMPLETIONS_URL =
  'https://openrouter.ai/api/v1/chat/completions'

/**
 * Compliance guardrail (IMA — Best Buy ToS): every prompt we send carries Best
 * Buy Content (product data) and/or user input. Best Buy's API ToS forbids
 * permitting third-party retention of Content and creating derivative works,
 * so the mitigation is ensuring the downstream LLM provider neither RETAINS nor
 * TRAINS on the prompt. OpenRouter expresses both as per-request provider
 * routing preferences (docs: openrouter.ai/docs/features/provider-routing and
 * .../privacy-and-logging):
 *   - `data_collection: "deny"` — route only to providers that do not store /
 *     train on inputs.
 *   - `zdr: true` — route only to Zero-Data-Retention endpoints (nothing kept
 *     after the request). OR's with account settings; can only tighten.
 * Failure mode is intentional: if a model has no deny-compliant endpoint,
 * OpenRouter returns HTTP 404 ("No endpoints found matching your data
 * policy…") rather than silently routing to a retaining provider. Compliance
 * over availability — we never ship Best Buy Content to a provider that keeps
 * it. Shared so both this streaming client and the voice transcription path
 * (transcribe-voice.ts) send the identical restriction.
 */
export const NO_DATA_RETENTION_PROVIDER = Object.freeze({
  data_collection: 'deny' as const,
  zdr: true as const,
})

export class OpenRouterRequestError extends Error {
  readonly status: number | null

  constructor(message: string, status: number | null) {
    super(message)
    this.name = 'OpenRouterRequestError'
    this.status = status
  }

  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403
  }
}

export interface CompletionResult {
  content: string
  toolCalls: ToolCallRequest[]
  reasoningDetails: ReasoningDetail[]
  finishReason: string | null
  /**
   * Usage accounting from the FINAL SSE chunk when `usage.include` was
   * requested (IMA-17 Phase 3 prerequisite). Carries `cost` (actual USD
   * billed) among token counts; null when the provider didn't report it.
   */
  usage: Record<string, unknown> | null
  /**
   * OpenRouter generation id (`chunk.id`) — the dedupe key for spend recording
   * and the lookup id for the /api/v1/generation cost fallback (IMA-16 #360).
   * Last non-null id across the stream wins; null if none was reported.
   */
  generationId: string | null
}

export interface StreamCompletionOptions {
  apiKey: string
  model: string
  messages: Record<string, unknown>[]
  tools?: Record<string, unknown>[]
  signal?: AbortSignal
  /** Called with each assistant text fragment as it streams in. */
  onDelta?: (delta: string) => void
  /** Test seam. */
  fetchImpl?: typeof fetch
}

interface ToolCallAccumulator {
  id: string
  name: string
  argumentsJson: string
}

/** Parse a data-URL-safe JSON arguments string, tolerating model slop. */
export function parseToolArguments(json: string): Record<string, unknown> {
  if (json.trim().length === 0) return {}
  try {
    const parsed = JSON.parse(json) as unknown
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed))
      return parsed as Record<string, unknown>
    return {}
  } catch {
    return {}
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/**
 * Merge a streamed reasoning_details fragment into the accumulator.
 * Fragments arrive index-keyed; string payload fields (text/summary/data)
 * are concatenated, everything else (type/id/format/signature) last-wins.
 */
export function mergeReasoningDetail(
  acc: Map<number, ReasoningDetail>,
  fragment: Record<string, unknown>,
  fallbackIndex: number,
): void {
  const index =
    typeof fragment.index === 'number' ? fragment.index : fallbackIndex
  const existing = acc.get(index)
  if (!existing) {
    const { index: _dropped, ...rest } = fragment
    acc.set(index, { ...rest })
    return
  }
  for (const [key, value] of Object.entries(fragment)) {
    if (key === 'index') continue
    if (
      (key === 'text' || key === 'summary' || key === 'data') &&
      typeof value === 'string' &&
      typeof existing[key] === 'string'
    ) {
      existing[key] = (existing[key] as string) + value
    } else {
      existing[key] = value
    }
  }
}

/** Apply one SSE JSON chunk to the accumulators. Exported for tests. */
export function applyStreamChunk(
  chunk: Record<string, unknown>,
  state: {
    content: string[]
    toolCalls: Map<number, ToolCallAccumulator>
    reasoning: Map<number, ReasoningDetail>
    finishReason: string | null
    usage: Record<string, unknown> | null
    generationId: string | null
  },
  onDelta?: (delta: string) => void,
): { finishReason: string | null } {
  // Mid-stream errors arrive as { error: { message } } events.
  const error = asRecord(chunk.error)
  if (error) {
    const message =
      typeof error.message === 'string' ? error.message : 'Model error'
    throw new OpenRouterRequestError(
      message,
      typeof error.code === 'number' ? error.code : null,
    )
  }

  // Generation id (IMA-16 #360): every chunk carries the same `id`; keep the
  // last non-empty one for spend dedupe + the cost fallback lookup.
  if (typeof chunk.id === 'string' && chunk.id.length > 0) {
    state.generationId = chunk.id
  }

  // Usage (IMA-17): with `usage.include`, OpenRouter emits a final chunk that
  // carries `usage` (cost + token counts) and typically empty choices. Last
  // report wins; capture it whenever present, independent of the choices path.
  const usage = asRecord(chunk.usage)
  if (usage) state.usage = usage

  const choices = Array.isArray(chunk.choices) ? chunk.choices : []
  const choice = asRecord(choices[0])
  if (!choice) return { finishReason: state.finishReason }

  const delta = asRecord(choice.delta) ?? asRecord(choice.message) ?? {}

  if (typeof delta.content === 'string' && delta.content.length > 0) {
    state.content.push(delta.content)
    onDelta?.(delta.content)
  }

  if (Array.isArray(delta.tool_calls)) {
    for (const raw of delta.tool_calls) {
      const tc = asRecord(raw)
      if (!tc) continue
      const index = typeof tc.index === 'number' ? tc.index : 0
      const fn = asRecord(tc.function) ?? {}
      const entry = state.toolCalls.get(index) ?? {
        id: '',
        name: '',
        argumentsJson: '',
      }
      if (typeof tc.id === 'string' && tc.id.length > 0) entry.id = tc.id
      if (typeof fn.name === 'string' && fn.name.length > 0)
        entry.name = fn.name
      if (typeof fn.arguments === 'string') entry.argumentsJson += fn.arguments
      state.toolCalls.set(index, entry)
    }
  }

  if (Array.isArray(delta.reasoning_details)) {
    let fallback = state.reasoning.size
    for (const raw of delta.reasoning_details) {
      const rd = asRecord(raw)
      if (!rd) continue
      mergeReasoningDetail(state.reasoning, rd, fallback)
      fallback += 1
    }
  }

  const finishReason =
    typeof choice.finish_reason === 'string'
      ? choice.finish_reason
      : state.finishReason
  return { finishReason }
}

function finalizeToolCalls(
  acc: Map<number, ToolCallAccumulator>,
): ToolCallRequest[] {
  return [...acc.entries()]
    .sort(([a], [b]) => a - b)
    .filter(([, tc]) => tc.name.length > 0)
    .map(([index, tc]) => ({
      id: tc.id.length > 0 ? tc.id : `call_${index}`,
      name: tc.name,
      argumentsJson: tc.argumentsJson.length > 0 ? tc.argumentsJson : '{}',
      arguments: parseToolArguments(tc.argumentsJson),
    }))
}

/**
 * One streaming chat completion. Resolves with the fully-accumulated
 * assistant turn; throws OpenRouterRequestError on HTTP/stream errors and
 * DOMException(AbortError) on cancellation.
 */
export async function streamCompletion(
  options: StreamCompletionOptions,
): Promise<CompletionResult> {
  const doFetch = options.fetchImpl ?? fetch
  const body: Record<string, unknown> = {
    model: options.model,
    messages: options.messages,
    stream: true,
    // Best Buy Content must not be retained/trained on (see
    // NO_DATA_RETENTION_PROVIDER). Applied unconditionally to every turn.
    provider: NO_DATA_RETENTION_PROVIDER,
    // Ask for reasoning blocks so they can be echoed back across turns.
    reasoning: { enabled: true },
    // Ask for usage accounting on the final chunk (IMA-17): `cost` is the
    // actual USD billed, which Phase 3 meters against the user's balance.
    usage: { include: true },
  }
  if (options.tools && options.tools.length > 0) body.tools = options.tools

  // Anthropic prompt caching is explicit opt-in (IMA-28). Top-level
  // cache_control makes OpenRouter place the breakpoint on the last cacheable
  // block and advance it as the conversation grows — writes cost 1.25x once,
  // reads 0.1x thereafter. Note: routes Anthropic-direct only (OpenRouter
  // excludes Bedrock/Vertex when top-level cache_control is present), which
  // is fine for us. Gemini caches implicitly; other vendors ignore it, but we
  // gate on vendor prefix to avoid surprising providers that reject unknown
  // fields.
  if (options.model.startsWith('anthropic/')) {
    body.cache_control = { type: 'ephemeral' }
  }

  const response = await doFetch(OPENROUTER_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://imagineapp.net',
      'X-Title': 'Imagine App',
    },
    body: JSON.stringify(body),
    signal: options.signal,
  })

  if (!response.ok) {
    let message = `OpenRouter request failed (${response.status})`
    try {
      const payload = (await response.json()) as {
        error?: { message?: string }
      }
      if (payload.error?.message) message = payload.error.message
    } catch {
      // Non-JSON error body; keep the status message.
    }
    throw new OpenRouterRequestError(message, response.status)
  }
  if (!response.body) {
    throw new OpenRouterRequestError('OpenRouter returned no body', null)
  }

  const state = {
    content: [] as string[],
    toolCalls: new Map<number, ToolCallAccumulator>(),
    reasoning: new Map<number, ReasoningDetail>(),
    finishReason: null as string | null,
    usage: null as Record<string, unknown> | null,
    generationId: null as string | null,
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let newlineIndex = buffer.indexOf('\n')
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trimEnd()
        buffer = buffer.slice(newlineIndex + 1)
        newlineIndex = buffer.indexOf('\n')

        // SSE comments (": OPENROUTER PROCESSING") and blank lines.
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (payload === '[DONE]') continue
        let chunk: Record<string, unknown>
        try {
          chunk = JSON.parse(payload) as Record<string, unknown>
        } catch {
          continue // Partial/corrupt frame; skip.
        }
        const { finishReason } = applyStreamChunk(chunk, state, options.onDelta)
        state.finishReason = finishReason
      }
    }
  } finally {
    reader.releaseLock()
  }

  return {
    content: state.content.join(''),
    toolCalls: finalizeToolCalls(state.toolCalls),
    reasoningDetails: [...state.reasoning.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, rd]) => rd),
    finishReason: state.finishReason,
    usage: state.usage,
    generationId: state.generationId,
  }
}
