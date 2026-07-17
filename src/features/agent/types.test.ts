import { describe, expect, it } from 'vitest'
import { type AssistantMessage, toApiMessage, userMessage } from './types'

describe('toApiMessage', () => {
  it('appends attached product context to user text', () => {
    const msg = userMessage('is this good?', {
      products: [{ sku: 1, name: 'TV', context: '[Attached product]\n# TV' }],
    })
    expect(toApiMessage(msg)).toEqual({
      role: 'user',
      content: 'is this good?\n\n[Attached product]\n# TV',
    })
  })

  it('uses multipart content when images are attached', () => {
    const msg = userMessage('what is this?', {
      images: [
        { dataUrl: 'data:image/jpeg;base64,abc', mimeType: 'image/jpeg' },
      ],
    })
    expect(toApiMessage(msg)).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'what is this?' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,abc' } },
      ],
    })
  })

  it('echoes tool-call arguments verbatim (not re-serialized)', () => {
    const assistant: AssistantMessage = {
      id: 'a',
      role: 'assistant',
      content: '',
      toolCalls: [
        {
          id: 'call_1',
          name: 'echo',
          argumentsJson: '{"a": 1}',
          arguments: { a: 1 },
        },
      ],
      reasoningDetails: [{ type: 'reasoning.encrypted', data: 'xyz' }],
      at: 0,
    }
    expect(toApiMessage(assistant)).toEqual({
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'echo', arguments: '{"a": 1}' },
        },
      ],
      reasoning_details: [{ type: 'reasoning.encrypted', data: 'xyz' }],
    })
  })
})
