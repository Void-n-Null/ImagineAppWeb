import { describe, expect, it } from 'vitest'
import { parseSseLine, readTurnEventStream } from './sse-stream'
import type { TurnEvent } from './turn-protocol'

/** Build a ReadableStream that emits `chunks` (as UTF-8) then closes. */
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let i = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i]))
        i += 1
      } else {
        controller.close()
      }
    },
  })
}

async function collect(chunks: string[]): Promise<TurnEvent[]> {
  const events: TurnEvent[] = []
  await readTurnEventStream(streamOf(chunks), (e) => events.push(e))
  return events
}

describe('parseSseLine', () => {
  it('decodes a data frame', () => {
    expect(parseSseLine('data: {"type":"status","label":"Thinking"}')).toEqual({
      type: 'status',
      label: 'Thinking',
    })
  })

  it('ignores keepalive comments and blank lines', () => {
    expect(parseSseLine(': keepalive')).toBeNull()
    expect(parseSseLine('')).toBeNull()
    expect(parseSseLine('   ')).toBeNull()
  })

  it('ignores non-data lines and [DONE]', () => {
    expect(parseSseLine('event: message')).toBeNull()
    expect(parseSseLine('data: [DONE]')).toBeNull()
  })

  it('skips malformed JSON rather than throwing', () => {
    expect(parseSseLine('data: {not json')).toBeNull()
  })
})

describe('readTurnEventStream', () => {
  it('parses multiple frames separated by blank lines', async () => {
    const events = await collect([
      'data: {"type":"status","label":"Thinking"}\n\n',
      'data: {"type":"done","reason":"complete"}\n\n',
    ])
    expect(events).toEqual([
      { type: 'status', label: 'Thinking' },
      { type: 'done', reason: 'complete' },
    ])
  })

  it('ignores interleaved keepalive comment frames', async () => {
    const events = await collect([
      ': keepalive\n\n',
      'data: {"type":"assistant-delta","messageId":"a","delta":"hi"}\n\n',
      ': keepalive\n\n',
    ])
    expect(events).toEqual([
      { type: 'assistant-delta', messageId: 'a', delta: 'hi' },
    ])
  })

  it('reassembles a frame split across chunk boundaries', async () => {
    // The JSON payload is cut mid-object by a network packet boundary.
    const events = await collect([
      'data: {"type":"stat',
      'us","label":"Sea',
      'rching"}\n\n',
    ])
    expect(events).toEqual([{ type: 'status', label: 'Searching' }])
  })

  it('handles a data line delivered without a trailing double newline', async () => {
    const events = await collect(['data: {"type":"done","reason":"complete"}'])
    expect(events).toEqual([{ type: 'done', reason: 'complete' }])
  })

  it('parses CRLF-terminated frames (trailing \\r trimmed)', async () => {
    const events = await collect([
      'data: {"type":"status","label":"Thinking"}\r\n\r\n',
    ])
    expect(events).toEqual([{ type: 'status', label: 'Thinking' }])
  })
})
