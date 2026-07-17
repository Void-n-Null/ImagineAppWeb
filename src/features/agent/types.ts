/**
 * Agent conversation types — the relocation-ready core (IMA-6).
 *
 * Everything here is plain data: no React, no DOM, no fetch. The same shapes
 * must survive a Phase-2 move of the loop to the server (IMA-17), so nothing
 * in this module may reference browser globals.
 *
 * Port of v1's chat_message.dart with one deliberate change: v1 mutated a
 * growing `apiMessages` array inside the runner; here the transcript IS the
 * source of truth and `toApiMessages` derives the wire format on demand.
 */

/** One tool invocation requested by the model. */
export interface ToolCallRequest {
  id: string
  name: string
  /** Raw JSON string as sent by the model (kept verbatim for echo-back). */
  argumentsJson: string
  /** Parsed arguments; {} when the model emitted malformed JSON. */
  arguments: Record<string, unknown>
}

/**
 * Reasoning blocks from reasoning models (Gemini, Claude, o-series).
 * Opaque to us — but they MUST be echoed back verbatim on the assistant
 * message in the next request or tool calling breaks mid-conversation
 * (v1 learned this the hard way: agent_runner.dart:104-110).
 */
export type ReasoningDetail = Record<string, unknown>

/** A product the user attached to their message (scan or SKU entry). */
export interface ProductAttachment {
  sku: number
  name: string
  /** Pre-formatted product context appended to the message for the LLM. */
  context: string
}

/** An image the user attached (vision models). Stored as a data URL. */
export interface ImageAttachment {
  /** data:image/...;base64,... */
  dataUrl: string
  mimeType: string
}

export interface UserMessage {
  id: string
  role: 'user'
  content: string
  attachedProducts?: ProductAttachment[]
  attachedImages?: ImageAttachment[]
  at: number
}

export interface AssistantMessage {
  id: string
  role: 'assistant'
  content: string
  toolCalls?: ToolCallRequest[]
  reasoningDetails?: ReasoningDetail[]
  at: number
}

export interface ToolResultMessage {
  id: string
  role: 'tool'
  toolCallId: string
  toolName: string
  content: string
  isError: boolean
  at: number
}

export type ChatMessage = UserMessage | AssistantMessage | ToolResultMessage

/** OpenAI-compatible wire message (subset we use). */
export type ApiMessage = Record<string, unknown>

let idCounter = 0
export function generateMessageId(): string {
  idCounter += 1
  return `msg_${Date.now().toString(36)}_${idCounter}`
}

export function userMessage(
  content: string,
  attachments?: {
    products?: ProductAttachment[]
    images?: ImageAttachment[]
  },
): UserMessage {
  return {
    id: generateMessageId(),
    role: 'user',
    content,
    attachedProducts: attachments?.products,
    attachedImages: attachments?.images,
    at: Date.now(),
  }
}

/** Build the text the LLM sees: user words + any attached product contexts. */
function userTextContent(msg: UserMessage): string {
  const contexts = msg.attachedProducts?.map((p) => p.context) ?? []
  if (contexts.length === 0) return msg.content
  return [msg.content, ...contexts].filter((s) => s.length > 0).join('\n\n')
}

/** Convert one transcript message into OpenAI chat-completions format. */
export function toApiMessage(msg: ChatMessage): ApiMessage {
  switch (msg.role) {
    case 'user': {
      const text = userTextContent(msg)
      const images = msg.attachedImages ?? []
      if (images.length === 0) return { role: 'user', content: text }
      const parts: Record<string, unknown>[] = []
      if (text.length > 0) parts.push({ type: 'text', text })
      for (const image of images) {
        parts.push({ type: 'image_url', image_url: { url: image.dataUrl } })
      }
      return { role: 'user', content: parts }
    }
    case 'assistant': {
      const out: ApiMessage = { role: 'assistant', content: msg.content }
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        out.tool_calls = msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          // Echo the model's own JSON back verbatim, not a re-serialization.
          function: { name: tc.name, arguments: tc.argumentsJson },
        }))
      }
      if (msg.reasoningDetails && msg.reasoningDetails.length > 0) {
        out.reasoning_details = msg.reasoningDetails
      }
      return out
    }
    case 'tool':
      return {
        role: 'tool',
        tool_call_id: msg.toolCallId,
        content: msg.content,
      }
  }
}

export function toApiMessages(
  systemPrompt: string | null,
  transcript: ChatMessage[],
): ApiMessage[] {
  const out: ApiMessage[] = []
  if (systemPrompt) out.push({ role: 'system', content: systemPrompt })
  for (const msg of transcript) out.push(toApiMessage(msg))
  return out
}

/* ── Runner events ──────────────────────────────────────────────────────── */

/**
 * Everything the loop tells the outside world. The UI subscribes to this
 * stream and owns all presentation; the runner never touches React state.
 */
export type AgentEvent =
  /** A model call started; label is a human-readable activity ("Thinking…"). */
  | { type: 'status'; label: string }
  /** Streaming text delta for the assistant message currently being written. */
  | { type: 'assistant-delta'; messageId: string; delta: string }
  /** The assistant message finished (may carry tool calls to run next). */
  | { type: 'assistant-message'; message: AssistantMessage }
  /** A tool started executing. */
  | { type: 'tool-start'; call: ToolCallRequest; label: string }
  /** A tool finished (result already appended to the transcript). */
  | { type: 'tool-result'; message: ToolResultMessage }
  /**
   * A tool call the server loop can't execute itself (IMA-17) — e.g.
   * request_scan, which needs the client's camera. The client executes it,
   * appends the tool result to its transcript, and re-invokes the turn so the
   * loop continues. One event per pending client-action call.
   */
  | { type: 'client_action'; call: ToolCallRequest }
  /** The loop ended. */
  | {
      type: 'done'
      reason:
        | 'complete'
        | 'max-iterations'
        | 'aborted'
        | 'error'
        | 'client-action'
    }
  /** Terminal failure (auth, network, malformed response). */
  | { type: 'error'; message: string; authExpired: boolean }
