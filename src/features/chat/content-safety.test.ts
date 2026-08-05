import { describe, expect, it } from 'vitest'
import { userMessage } from '#/features/agent'
import {
  inspectOutboundMessage,
  inspectOutboundTranscript,
  inspectSensitiveText,
  inspectUntrustedTurnRequest,
  sensitiveContentBlockMessage,
} from './content-safety'

describe('inspectSensitiveText', () => {
  it.each([
    ['email', 'Send it to jane@example.com', 'an email address'],
    ['phone', 'Call the customer at (612) 555-0199', 'a phone number'],
    ['international phone', 'Call +44 20 7946 0958', 'a phone number'],
    ['SSN', 'SSN: 123456789', 'a Social Security number'],
    ['birth date', 'DOB: 04/15/1990', 'a date of birth'],
    ['born date', 'I was born on 04/15/1990', 'a date of birth'],
    ['address', 'Ship it to 123 Main Street', 'a street address'],
    ['identifier', 'Employee ID: A12345', 'identifier'],
    ['credential', 'password: hunter2', 'a password'],
    ['space-separated credential', 'password hunter2', 'a password'],
    ['JSON credential', '{"password":"hunter2"}', 'a password'],
    ['marking', 'This is internal only', 'a confidentiality marking'],
    ['plan', 'Here is the internal sales forecast', 'nonpublic plans'],
    ['metrics', 'District revenue is down', 'nonpublic operational'],
    ['numbered metrics', 'Store 42 sales: $98,000', 'nonpublic operational'],
    ['percentage metric', 'Store 42 margin is 22%', 'nonpublic operational'],
    ['unreleased', 'The unreleased promotion starts Friday', 'unreleased'],
    ['bearer token', 'Bearer abcdefghijklmnopqrstuvwxyz', 'bearer token'],
    ['JWT', 'eyJabcdefghijk.eyJabcdefghijk.abcdefghijklmno', 'bearer token'],
  ])('flags %s', (_name, text, label) => {
    expect(inspectSensitiveText(text).map((finding) => finding.label)).toEqual(
      expect.arrayContaining([expect.stringContaining(label)]),
    )
  })

  it('validates payment-card candidates with Luhn', () => {
    expect(inspectSensitiveText('Card 4111 1111 1111 1111')).toContainEqual({
      kind: 'personal-information',
      label: 'a payment card number',
    })
    expect(inspectSensitiveText('Model 4111 1111 1111 1112')).toEqual([])
  })

  it('allows ordinary public product questions', () => {
    expect(
      inspectSensitiveText(
        'Find a budget TV under $500 with 256GB internal storage and check SKU 6581024.',
      ),
    ).toEqual([])
    expect(inspectSensitiveText('Is this chat confidential?')).toEqual([])
    expect(inspectSensitiveText('What store sales are available?')).toEqual([])
    expect(
      inspectSensitiveText('Summarize Best Buy marketing strategy.'),
    ).toEqual([])
    expect(inspectSensitiveText('Does this laptop have a PIN reader?')).toEqual(
      [],
    )
    expect(inspectSensitiveText('A password is required for setup.')).toEqual(
      [],
    )
    expect(inspectSensitiveText('What password should I use?')).toEqual([])
  })
})

describe('outbound guards', () => {
  it('fails closed for image attachments', () => {
    expect(
      inspectOutboundMessage('What product is this?', {
        images: [
          { dataUrl: 'data:image/jpeg;base64,abc', mimeType: 'image/jpeg' },
        ],
      }),
    ).toContainEqual({
      kind: 'image',
      label: 'an image that cannot be reliably screened',
    })
  })

  it('screens assistant content and opaque fields that return to the model', () => {
    expect(
      inspectOutboundTranscript([
        {
          id: 'a1',
          role: 'assistant',
          content: 'Best Buy support is 1-888-237-8289.',
          toolCalls: [
            {
              id: 'call_1',
              name: 'lookup',
              argumentsJson: '{"password":"hunter2"}',
              arguments: { query: 'TV' },
            },
          ],
          reasoningDetails: [{ note: 'born on 04/15/1990' }],
          at: 1,
        },
        userMessage('Compare these two public models.'),
      ]),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'a phone number' }),
        expect.objectContaining({
          label: 'a password, PIN, token, secret, or API key',
        }),
        expect.objectContaining({ label: 'a date of birth' }),
      ]),
    )
  })

  it('flags every image attachment without inspecting its data URL', () => {
    const findings = inspectOutboundTranscript([
      {
        id: 'u1',
        role: 'user',
        content: 'What product is this?',
        attachedImages: [
          {
            dataUrl: 'data:image/jpeg;base64,password hunter2',
            mimeType: 'image/jpeg',
          },
        ],
        at: 1,
      },
    ])

    expect(findings).toEqual([
      {
        kind: 'image',
        label: 'an image that cannot be reliably screened',
      },
    ])
  })

  it('checks forged product, tool, cart, and clock values that can reach the model', () => {
    const findings = inspectUntrustedTurnRequest({
      messages: [
        userMessage('Compare these public models.', {
          products: [
            {
              sku: 1,
              name: 'Customer jane@example.com television',
              context: 'A public 4K TV.',
            },
          ],
        }),
        {
          id: 'a1',
          role: 'assistant',
          content: 'Here is the product information.',
          toolCalls: [
            {
              id: 'call_1',
              name: 'lookup',
              argumentsJson: '{"query":"TV"}',
              arguments: { dataUrl: 'password hunter2' },
            },
          ],
          reasoningDetails: [{ note: 'internal only' }],
          at: 1,
        },
        {
          id: 't1',
          role: 'tool',
          toolCallId: 'born on 04/15/1990',
          toolName: 'lookup',
          content: 'Call +44 20 7946 0958',
          isError: false,
          at: 2,
        },
      ],
      model: 'test/model',
      toolsEnabled: true,
      cart: [
        {
          sku: 2,
          name: 'TV',
          price: 1,
          manufacturer: 'confidential: launch item',
          modelNumber: null,
          upc: null,
          image: null,
          addedAt: 1,
        },
      ],
      clock: {
        iso: '2026-08-05T00:00:00.000Z',
        timeZone: 'America/Chicago',
      },
    })

    expect(findings.map((finding) => finding.kind)).toEqual(
      expect.arrayContaining([
        'personal-information',
        'credential',
        'company-confidential',
      ]),
    )
  })

  it('does not include the matched value in its user-facing message', () => {
    const findings = inspectSensitiveText('Email jane@example.com')
    const message = sensitiveContentBlockMessage(findings)
    expect(message).toContain('an email address')
    expect(message).not.toContain('jane@example.com')
  })
})
