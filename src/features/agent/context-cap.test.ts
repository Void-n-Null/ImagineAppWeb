import { describe, expect, it } from 'vitest'
import {
  capTranscript,
  DEFAULT_CONTEXT_BUDGET_TOKENS,
  estimateMessageTokens,
} from './context-cap'
import type {
  AssistantMessage,
  ChatMessage,
  ToolResultMessage,
  UserMessage,
} from './types'

/**
 * Boundary cases for the transcript context cap (IMA-16 #364). The two
 * protocol invariants under test: the kept window starts at a user message
 * (never orphaning a tool result from its assistant tool_call), and the newest
 * user message is always kept even when it alone blows the budget.
 */

let seq = 0
function user(content: string): UserMessage {
  seq += 1
  return { id: `u${seq}`, role: 'user', content, at: seq }
}
function assistantWithToolCall(
  content: string,
  argsJson: string,
): AssistantMessage {
  seq += 1
  return {
    id: `a${seq}`,
    role: 'assistant',
    content,
    toolCalls: [
      {
        id: `call_${seq}`,
        name: 'search',
        argumentsJson: argsJson,
        arguments: {},
      },
    ],
    at: seq,
  }
}
function toolResult(content: string): ToolResultMessage {
  seq += 1
  return {
    id: `t${seq}`,
    role: 'tool',
    toolCallId: `call_${seq}`,
    toolName: 'search',
    content,
    isError: false,
    at: seq,
  }
}

/** ~n tokens of filler (4 chars ≈ 1 token). */
function filler(tokens: number): string {
  return 'x'.repeat(tokens * 4)
}

describe('estimateMessageTokens', () => {
  it('counts ceil(chars/4) for plain text', () => {
    expect(estimateMessageTokens(user('xxxx'))).toBe(1)
    expect(estimateMessageTokens(user('xxxxx'))).toBe(2) // ceil(5/4)
  })

  it('adds ~1100 tokens per attached image', () => {
    const msg: UserMessage = {
      id: 'i',
      role: 'user',
      content: '',
      attachedImages: [{ dataUrl: 'data:...', mimeType: 'image/png' }],
      at: 1,
    }
    expect(estimateMessageTokens(msg)).toBe(1100)
  })

  it('counts tool-call argument JSON on assistant messages', () => {
    const msg = assistantWithToolCall('', filler(10))
    // 40 chars of args → 10 tokens.
    expect(estimateMessageTokens(msg)).toBe(10)
  })
})

describe('capTranscript', () => {
  it('returns empty input unchanged', () => {
    expect(capTranscript([])).toEqual([])
  })

  it('returns the input unchanged when it already fits the budget', () => {
    const messages: ChatMessage[] = [user('hi'), user('there')]
    expect(capTranscript(messages, 1000)).toBe(messages)
  })

  it('drops the oldest messages beyond the budget', () => {
    // Three user messages ~100 tokens each; budget 250 keeps the newest 2.
    const a = user(filler(100))
    const b = user(filler(100))
    const c = user(filler(100))
    const out = capTranscript([a, b, c], 250)
    expect(out).toEqual([b, c])
  })

  it('always keeps the newest user message even if it alone exceeds budget', () => {
    const old = user(filler(50))
    const huge = user(filler(10_000))
    const out = capTranscript([old, huge], 100)
    // The huge newest user message survives despite blowing the budget.
    expect(out).toEqual([huge])
  })

  it('never starts the window on a tool result (orphan prevention)', () => {
    // Layout: [u0 huge][assistant tool_call][tool result][u_final small].
    // A naive by-token cut from the end would keep [tool result][u_final],
    // orphaning the tool result. The cap must advance the start to u_final.
    const u0 = user(filler(400))
    const a = assistantWithToolCall('', filler(100))
    const t = toolResult(filler(100))
    const uFinal = user(filler(10))
    // Budget only fits the tail; the assistant+tool unit can't be kept whole.
    const out = capTranscript([u0, a, t, uFinal], 150)
    expect(out[0].role).toBe('user')
    // The dropped assistant tool_call's result must not lead the window.
    expect(out).toEqual([uFinal])
  })

  it('keeps the assistant+tool unit when it fits, since the window starts at its user turn', () => {
    // [u0][assistant tool_call][tool result] where the whole thing fits.
    const u0 = user(filler(10))
    const a = assistantWithToolCall('', filler(10))
    const t = toolResult(filler(10))
    const out = capTranscript([u0, a, t], 1000)
    expect(out).toEqual([u0, a, t])
  })

  it('advances past a leading assistant/tool pair to the next user message', () => {
    // [u0][a][t][u1][a2][t2] — budget fits only from u1 onward.
    const u0 = user(filler(300))
    const a0 = assistantWithToolCall('', filler(100))
    const t0 = toolResult(filler(100))
    const u1 = user(filler(50))
    const a1 = assistantWithToolCall('', filler(30))
    const t1 = toolResult(filler(30))
    const out = capTranscript([u0, a0, t0, u1, a1, t1], 200)
    expect(out[0]).toBe(u1)
    expect(out).toEqual([u1, a1, t1])
  })

  it('uses the default budget when none is given', () => {
    // A transcript comfortably under 24k tokens passes through untouched.
    const messages = [user('short'), user('also short')]
    expect(capTranscript(messages)).toBe(messages)
    expect(DEFAULT_CONTEXT_BUDGET_TOKENS).toBe(24_000)
  })
})
