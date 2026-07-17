/**
 * SSE frame parsing for the server turn endpoint (IMA-17 Phase 2).
 *
 * The endpoint emits `data: <json>\n\n` frames and `: keepalive\n\n` comments
 * (see api.agent.turn.ts). This mirrors the line-buffering approach the
 * OpenRouter client uses (openrouter.ts streamCompletion): split on '\n',
 * keep only `data:` lines, ignore comments/blank lines, JSON.parse each
 * payload, and SKIP malformed frames rather than throwing — a partial or
 * corrupt frame must never kill the stream.
 *
 * Two seams: {@link parseSseLine} is the pure per-line decision (tested
 * directly), and {@link readTurnEventStream} drives a ReadableStream reader
 * through the line buffer, invoking a callback per decoded TurnEvent.
 */

import type { TurnEvent } from './turn-protocol'

/**
 * Decode one already-split SSE line into a TurnEvent, or null when the line
 * carries no event (comment, blank line, non-`data:` line, `[DONE]`, or a
 * malformed JSON payload we deliberately skip).
 */
export function parseSseLine(line: string): TurnEvent | null {
  const trimmed = line.trimEnd()
  // Comments (": keepalive") and blank lines carry no data.
  if (!trimmed.startsWith('data:')) return null
  const payload = trimmed.slice(5).trim()
  if (payload.length === 0 || payload === '[DONE]') return null
  try {
    return JSON.parse(payload) as TurnEvent
  } catch {
    // Partial/corrupt frame — skip it, keep the stream alive.
    return null
  }
}

/**
 * Read `body` to completion, decoding each complete SSE frame into a
 * TurnEvent and handing it to `onEvent`. Buffers across chunk boundaries so a
 * frame split mid-JSON by a network packet still parses once its final byte
 * arrives. Returns when the stream ends (server closed) — the caller decides
 * whether that was a clean 'done' or a mid-turn drop.
 */
export async function readTurnEventStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: TurnEvent) => void,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let newlineIndex = buffer.indexOf('\n')
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex)
        buffer = buffer.slice(newlineIndex + 1)
        newlineIndex = buffer.indexOf('\n')

        const event = parseSseLine(line)
        if (event) onEvent(event)
      }
    }
    // Flush any trailing line the server didn't terminate with a newline.
    const tail = parseSseLine(buffer)
    if (tail) onEvent(tail)
  } finally {
    reader.releaseLock()
  }
}
