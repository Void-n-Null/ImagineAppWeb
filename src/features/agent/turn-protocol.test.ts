import { describe, expect, it } from 'vitest'
import { validateTurnRequest } from './turn-protocol'

/** A minimal valid body, spread-overridable per test. */
function body(overrides: Record<string, unknown> = {}) {
  return {
    model: 'anthropic/claude-sonnet-5',
    toolsEnabled: true,
    cart: [],
    clock: { iso: '2026-07-07T12:00:00.000Z', timeZone: 'America/Chicago' },
    messages: [{ role: 'user', content: 'hi', id: 'm1', at: 1 }],
    ...overrides,
  }
}

describe('validateTurnRequest — accepts', () => {
  it('a minimal valid body and drops unknown fields', () => {
    const result = validateTurnRequest(body({ nonsense: 'x', extra: 42 }))
    expect(result.model).toBe('anthropic/claude-sonnet-5')
    expect(result.toolsEnabled).toBe(true)
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]).toMatchObject({ role: 'user', content: 'hi' })
    expect(result).not.toHaveProperty('nonsense')
  })

  it('assistant tool_calls and reasoning, and tool results', () => {
    const result = validateTurnRequest(
      body({
        messages: [
          { role: 'user', content: 'find a tv' },
          {
            role: 'assistant',
            content: '',
            toolCalls: [
              {
                id: 'call_1',
                name: 'search_products',
                argumentsJson: '{"query":"tv"}',
                arguments: { query: 'tv' },
              },
            ],
            reasoningDetails: [{ type: 'reasoning.text', text: 'think' }],
          },
          {
            role: 'tool',
            toolCallId: 'call_1',
            toolName: 'search_products',
            content: 'results…',
            isError: false,
          },
        ],
      }),
    )
    expect(result.messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'tool',
    ])
    const assistant = result.messages[1]
    expect(assistant).toMatchObject({ role: 'assistant' })
  })

  it('a cart snapshot and a vision image data URL', () => {
    const result = validateTurnRequest(
      body({
        cart: [
          {
            sku: 123,
            name: 'TV',
            price: 499.99,
            manufacturer: 'Sony',
            modelNumber: null,
            upc: null,
            image: null,
            addedAt: 1,
          },
        ],
        messages: [
          {
            role: 'user',
            content: 'what is this?',
            attachedImages: [
              { dataUrl: 'data:image/jpeg;base64,abc', mimeType: 'image/jpeg' },
            ],
          },
        ],
      }),
    )
    expect(result.cart).toHaveLength(1)
    expect(result.cart[0]?.sku).toBe(123)
  })

  it('coerces toolsEnabled to a strict boolean', () => {
    expect(
      validateTurnRequest(body({ toolsEnabled: 'yes' })).toolsEnabled,
    ).toBe(false)
    expect(
      validateTurnRequest(body({ toolsEnabled: false })).toolsEnabled,
    ).toBe(false)
  })
})

describe('validateTurnRequest — rejects', () => {
  const cases: [string, unknown][] = [
    ['non-object body', 42],
    ['null body', null],
    ['empty model', body({ model: '   ' })],
    ['non-string model', body({ model: 123 })],
    ['overlong model', body({ model: 'x'.repeat(101) })],
    ['empty messages', body({ messages: [] })],
    ['non-array messages', body({ messages: {} })],
    ['unknown role', body({ messages: [{ role: 'system', content: 'x' }] })],
    ['non-string content', body({ messages: [{ role: 'user', content: 5 }] })],
    [
      'tool message missing toolCallId',
      body({
        messages: [
          { role: 'tool', toolName: 't', content: 'c', isError: false },
        ],
      }),
    ],
    ['non-array cart', body({ cart: {} })],
    [
      'cart item bad sku',
      body({ cart: [{ sku: 'x', name: 'TV', price: null }] }),
    ],
    ['missing clock', body({ clock: undefined })],
    ['clock missing timeZone', body({ clock: { iso: 'x' } })],
  ]

  for (const [name, input] of cases) {
    it(name, () => {
      expect(() => validateTurnRequest(input)).toThrow()
    })
  }

  it('too many messages', () => {
    const many = Array.from({ length: 201 }, () => ({
      role: 'user' as const,
      content: 'x',
    }))
    expect(() => validateTurnRequest(body({ messages: many }))).toThrow(
      /exceeds 200/,
    )
  })

  it('too many cart items', () => {
    const many = Array.from({ length: 101 }, (_, i) => ({
      sku: i,
      name: 'x',
      price: null,
    }))
    expect(() => validateTurnRequest(body({ cart: many }))).toThrow(
      /exceeds 100/,
    )
  })

  it('an oversized image data URL', () => {
    const huge = `data:image/png;base64,${'A'.repeat(1_000_001)}`
    expect(() =>
      validateTurnRequest(
        body({
          messages: [
            {
              role: 'user',
              content: 'x',
              attachedImages: [{ dataUrl: huge, mimeType: 'image/png' }],
            },
          ],
        }),
      ),
    ).toThrow(/exceeds/)
  })

  it('a body over the total size ceiling', () => {
    // One giant content string blows past 1.5 MB even though it's one message.
    const big = 'x'.repeat(1_600_000)
    expect(() =>
      validateTurnRequest(body({ messages: [{ role: 'user', content: big }] })),
    ).toThrow(/exceeds/)
  })
})
