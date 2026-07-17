/**
 * Turn protocol (IMA-17 Phase 2): the serializable request/event contract
 * shared by the server turn endpoint (api.agent.turn.ts) and the client that
 * drives it. Phase 1 kept the loop in the browser on the user's own key;
 * Phase 2 moves it to a server endpoint on the app's pool key, so everything
 * that crosses that boundary must be plain JSON and — critically — the
 * request body is now UNTRUSTED input. validateTurnRequest is the gate.
 *
 * Only data lives here: no fetch, no React. The server imports the runner's
 * AgentEvent and layers on the two things the client must act on itself —
 * client_action (request_scan handoff) and cart mutations the server made on
 * the per-turn snapshot.
 */

import type { CartItem } from '#/features/cart/cart-store'
import type { AgentEvent, ChatMessage, ToolCallRequest } from './types'

/** Body of POST /api/agent/turn. Untrusted — see validateTurnRequest. */
export interface TurnRequestBody {
  /** Client-held transcript, ending with the newest user message. */
  messages: ChatMessage[]
  model: string
  toolsEnabled: boolean
  /** Device cart snapshot for this turn; the server mutates a copy. */
  cart: CartItem[]
  /** Device wall clock: ISO timestamp + IANA timezone. */
  clock: { iso: string; timeZone: string }
}

/**
 * Everything the endpoint streams back. A superset of the runner's events
 * plus the two client-actionable event kinds Phase 2 introduces.
 */
export type TurnEvent =
  | AgentEvent
  /** request_scan handoff: the client runs it and re-invokes the turn. */
  | { type: 'client_action'; call: ToolCallRequest }
  /** A cart mutation the server made — the client applies it to its store. */
  | { type: 'cart'; op: 'add'; item: CartItem }
  | { type: 'cart'; op: 'remove'; sku: number }
  | { type: 'cart'; op: 'clear' }

/* ── Validation ─────────────────────────────────────────────────────────── */

// Hard bounds. The body is attacker-controlled once the loop is server-side
// (they hold a session cookie, not our pool key), so every array is capped and
// the total JSON size is bounded before we spend a cent on a model call.
const MAX_MESSAGES = 200
const MAX_CART_ITEMS = 100
const MAX_MODEL_LEN = 100
const MAX_TOTAL_BYTES = 1_500_000 // 1.5 MB
const MAX_IMAGE_BYTES = 1_000_000 // 1 MB per attached image data URL

const MESSAGE_ROLES = new Set(['user', 'assistant', 'tool'])

class ValidationError extends Error {}

function fail(message: string): never {
  throw new ValidationError(message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** UTF-8 byte length without pulling in Buffer (works in every runtime). */
function byteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

function requireString(value: unknown, what: string): string {
  if (typeof value !== 'string') fail(`${what} must be a string`)
  return value as string
}

function optionalString(value: unknown, what: string): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') fail(`${what} must be a string`)
  return value
}

function validateImages(
  value: unknown,
): { dataUrl: string; mimeType: string }[] | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) fail('attachedImages must be an array')
  return value.map((raw, i) => {
    if (!isRecord(raw)) fail(`attachedImages[${i}] must be an object`)
    const dataUrl = requireString(raw.dataUrl, `attachedImages[${i}].dataUrl`)
    // Vision data URLs are allowed but bounded — a rogue client could
    // otherwise pad the transcript with megabytes of base64 per image.
    if (!dataUrl.startsWith('data:')) {
      fail(`attachedImages[${i}].dataUrl must be a data: URL`)
    }
    if (byteLength(dataUrl) > MAX_IMAGE_BYTES) {
      fail(`attachedImages[${i}].dataUrl exceeds ${MAX_IMAGE_BYTES} bytes`)
    }
    const mimeType = requireString(
      raw.mimeType,
      `attachedImages[${i}].mimeType`,
    )
    return { dataUrl, mimeType }
  })
}

function validateProducts(
  value: unknown,
): { sku: number; name: string; context: string }[] | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) fail('attachedProducts must be an array')
  return value.map((raw, i) => {
    if (!isRecord(raw)) fail(`attachedProducts[${i}] must be an object`)
    if (typeof raw.sku !== 'number' || !Number.isSafeInteger(raw.sku)) {
      fail(`attachedProducts[${i}].sku must be an integer`)
    }
    return {
      sku: raw.sku,
      name: requireString(raw.name, `attachedProducts[${i}].name`),
      context: requireString(raw.context, `attachedProducts[${i}].context`),
    }
  })
}

/**
 * Reconstruct one transcript message from untrusted input, keeping only known
 * fields (unknown extras are dropped) and re-deriving message ids/timestamps
 * we don't trust from the client anyway. Roles are limited to the three the
 * loop understands.
 */
function validateMessage(raw: unknown, i: number): ChatMessage {
  if (!isRecord(raw)) fail(`messages[${i}] must be an object`)
  const role = raw.role
  if (typeof role !== 'string' || !MESSAGE_ROLES.has(role)) {
    fail(`messages[${i}].role must be one of user|assistant|tool`)
  }
  const content = requireString(raw.content, `messages[${i}].content`)
  const at = typeof raw.at === 'number' ? raw.at : Date.now()
  const id = typeof raw.id === 'string' ? raw.id : `msg_${i}`

  if (role === 'user') {
    return {
      id,
      role: 'user',
      content,
      attachedProducts: validateProducts(raw.attachedProducts),
      attachedImages: validateImages(raw.attachedImages),
      at,
    }
  }

  if (role === 'assistant') {
    const toolCalls = validateToolCalls(raw.toolCalls, i)
    const reasoningDetails = validateReasoning(raw.reasoningDetails, i)
    return {
      id,
      role: 'assistant',
      content,
      toolCalls,
      reasoningDetails,
      at,
    }
  }

  // role === 'tool'
  return {
    id,
    role: 'tool',
    toolCallId: requireString(raw.toolCallId, `messages[${i}].toolCallId`),
    toolName: requireString(raw.toolName, `messages[${i}].toolName`),
    content,
    isError: raw.isError === true,
    at,
  }
}

function validateToolCalls(
  value: unknown,
  i: number,
): ToolCallRequest[] | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) fail(`messages[${i}].toolCalls must be an array`)
  return value.map((raw, j) => {
    if (!isRecord(raw)) fail(`messages[${i}].toolCalls[${j}] must be an object`)
    const argumentsJson = optionalString(
      raw.argumentsJson,
      `messages[${i}].toolCalls[${j}].argumentsJson`,
    )
    const args = isRecord(raw.arguments) ? raw.arguments : {}
    return {
      id: requireString(raw.id, `messages[${i}].toolCalls[${j}].id`),
      name: requireString(raw.name, `messages[${i}].toolCalls[${j}].name`),
      argumentsJson: argumentsJson ?? '{}',
      arguments: args,
    }
  })
}

function validateReasoning(
  value: unknown,
  i: number,
): Record<string, unknown>[] | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) {
    fail(`messages[${i}].reasoningDetails must be an array`)
  }
  return value.map((raw, j) => {
    if (!isRecord(raw)) {
      fail(`messages[${i}].reasoningDetails[${j}] must be an object`)
    }
    return raw
  })
}

function validateCart(value: unknown): CartItem[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) fail('cart must be an array')
  if (value.length > MAX_CART_ITEMS) {
    fail(`cart exceeds ${MAX_CART_ITEMS} items`)
  }
  return value.map((raw, i) => {
    if (!isRecord(raw)) fail(`cart[${i}] must be an object`)
    if (typeof raw.sku !== 'number' || !Number.isSafeInteger(raw.sku)) {
      fail(`cart[${i}].sku must be an integer`)
    }
    const price =
      raw.price === null || typeof raw.price === 'number'
        ? (raw.price as number | null)
        : fail(`cart[${i}].price must be a number or null`)
    return {
      sku: raw.sku,
      name: requireString(raw.name, `cart[${i}].name`),
      price,
      manufacturer: nullableString(raw.manufacturer, `cart[${i}].manufacturer`),
      modelNumber: nullableString(raw.modelNumber, `cart[${i}].modelNumber`),
      upc: nullableString(raw.upc, `cart[${i}].upc`),
      image: nullableString(raw.image, `cart[${i}].image`),
      addedAt: typeof raw.addedAt === 'number' ? raw.addedAt : Date.now(),
    }
  })
}

function nullableString(value: unknown, what: string): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') fail(`${what} must be a string or null`)
  return value
}

function validateClock(value: unknown): { iso: string; timeZone: string } {
  if (!isRecord(value)) fail('clock must be an object')
  return {
    iso: requireString(value.iso, 'clock.iso'),
    timeZone: requireString(value.timeZone, 'clock.timeZone'),
  }
}

/**
 * Hard-validate the untrusted turn request body. Throws Error (with a
 * human-readable message) on anything malformed; the endpoint turns that into
 * a 400. Unknown extra fields are dropped by reconstruction.
 */
export function validateTurnRequest(input: unknown): TurnRequestBody {
  // Bound total size first — reject a 50 MB blob before walking it. We stringify
  // the already-parsed body rather than trusting a Content-Length header.
  let serialized: string
  try {
    serialized = JSON.stringify(input)
  } catch {
    fail('request body is not serializable')
  }
  if (serialized === undefined) fail('request body is empty')
  if (byteLength(serialized) > MAX_TOTAL_BYTES) {
    fail(`request body exceeds ${MAX_TOTAL_BYTES} bytes`)
  }

  if (!isRecord(input)) fail('request body must be a JSON object')

  const model = requireString(input.model, 'model').trim()
  if (model.length === 0) fail('model must be a non-empty string')
  if (model.length > MAX_MODEL_LEN) {
    fail(`model must be ${MAX_MODEL_LEN} characters or fewer`)
  }

  if (!Array.isArray(input.messages)) fail('messages must be an array')
  if (input.messages.length === 0) fail('messages must not be empty')
  if (input.messages.length > MAX_MESSAGES) {
    fail(`messages exceeds ${MAX_MESSAGES} entries`)
  }
  const messages = input.messages.map((m, i) => validateMessage(m, i))

  return {
    messages,
    model,
    toolsEnabled: input.toolsEnabled === true,
    cart: validateCart(input.cart),
    clock: validateClock(input.clock),
  }
}
