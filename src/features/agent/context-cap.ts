import type { ChatMessage } from './types'

/**
 * Transcript context cap (IMA-16 #364, design: IMA-DOC-16 "Context cap").
 *
 * The measured cost driver is transcript growth — re-reading the whole thread
 * on every call was 73% of the heaviest question's cost (IMA-16 #455). If
 * users never start new threads, per-call prompt tokens grow unbounded and eat
 * grants. This drops the OLDEST messages once the estimated token budget is
 * exceeded, keeping a recent window.
 *
 * Two protocol invariants the naive "keep the last N tokens" would violate:
 *
 *  1. The kept window MUST start at a user message. An assistant tool_calls
 *     message and its answering tool result(s) are an inseparable unit under
 *     the OpenAI protocol — a tool result with no preceding assistant
 *     tool_call, or an assistant tool_call with no following result, is a 400.
 *     So we never let the window begin on an 'assistant' or 'tool' message; we
 *     advance the cut forward to the next 'user' message.
 *
 *  2. The newest user message is ALWAYS kept, even if it alone exceeds the
 *     budget (a single huge pasted spec sheet must still be answerable).
 *
 * Token estimate is deliberately crude (ceil(chars/4) + 1100/image) — it only
 * needs to bound growth, not be exact; OpenRouter bills the real number.
 */

export const DEFAULT_CONTEXT_BUDGET_TOKENS = 24_000

/** Rough per-image token cost added on top of any text (vision models). */
const IMAGE_TOKEN_COST = 1100

/** Estimate the token cost of one message: ceil(chars/4) + images. */
export function estimateMessageTokens(message: ChatMessage): number {
  let chars = message.content.length
  if (message.role === 'user') {
    // Attached product contexts are inlined into the wire text (types.ts),
    // so they count toward the prompt even though they live in a side field.
    for (const p of message.attachedProducts ?? []) chars += p.context.length
  }
  if (message.role === 'assistant') {
    // Tool-call argument JSON and reasoning blocks are echoed on the wire too.
    for (const tc of message.toolCalls ?? []) chars += tc.argumentsJson.length
    for (const rd of message.reasoningDetails ?? []) {
      chars += JSON.stringify(rd).length
    }
  }
  let tokens = Math.ceil(chars / 4)
  if (message.role === 'user') {
    tokens += (message.attachedImages?.length ?? 0) * IMAGE_TOKEN_COST
  }
  return tokens
}

/**
 * Trim `messages` to fit `budget` estimated tokens, dropping oldest first,
 * while preserving the two invariants above. Returns a NEW array (never
 * mutates the input); returns it unchanged when it already fits or is empty.
 */
export function capTranscript(
  messages: ChatMessage[],
  budget: number = DEFAULT_CONTEXT_BUDGET_TOKENS,
): ChatMessage[] {
  if (messages.length === 0) return messages

  // Per-message token estimates, indexed alongside `messages`.
  const tokens = messages.map(estimateMessageTokens)
  const total = tokens.reduce((a, b) => a + b, 0)
  if (total <= budget) return messages

  // The newest user message is the floor of what we keep — find its index.
  // (There should always be one — turns are user-initiated — but if somehow
  //  absent, keep the last message so we never return empty.)
  let newestUserIdx = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      newestUserIdx = i
      break
    }
  }
  const floorIdx = newestUserIdx === -1 ? messages.length - 1 : newestUserIdx

  // Walk a candidate cut from the newest kept-floor backward, accumulating
  // tokens, and keep going while the window fits. `start` is the first index
  // we intend to keep.
  let start = floorIdx
  let windowTokens = tokens.slice(floorIdx).reduce((a, b) => a + b, 0)

  for (let i = floorIdx - 1; i >= 0; i--) {
    const next = windowTokens + tokens[i]
    if (next > budget) break
    windowTokens = next
    start = i
  }

  // Invariant 1: the window must START on a user message. If `start` landed on
  // an assistant/tool message, advance it forward to the next user message so
  // we never orphan a tool result from its assistant tool_call.
  while (start < floorIdx && messages[start].role !== 'user') {
    start++
  }

  return messages.slice(start)
}
