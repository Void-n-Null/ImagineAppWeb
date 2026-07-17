import { beforeEach, describe, expect, it, vi } from 'vitest'

// The server function is mocked: transcribeAudio is now a thin client over it
// (IMA-17 #357). The OpenRouter fetch it used to do lives server-side in
// transcribe-voice.ts, whose validation is tested in that file's suite.
const transcribeVoice = vi.fn()
vi.mock('#/server/functions/transcribe-voice', () => ({
  transcribeVoice: (args: unknown) => transcribeVoice(args),
}))

import {
  extractContent,
  TranscriptionError,
  transcribeAudio,
} from './transcribe'

describe('extractContent', () => {
  it('reads plain string content, trimmed', () => {
    expect(
      extractContent({
        choices: [{ message: { content: '  hello floor \n' } }],
      }),
    ).toBe('hello floor')
  })

  it('joins content-part arrays', () => {
    expect(
      extractContent({
        choices: [
          {
            message: {
              content: [
                { type: 'text', text: 'do we have ' },
                { type: 'text', text: 'the QM8K' },
              ],
            },
          },
        ],
      }),
    ).toBe('do we have the QM8K')
  })

  it('returns empty string for malformed payloads', () => {
    expect(extractContent(null)).toBe('')
    expect(extractContent({})).toBe('')
    expect(extractContent({ choices: [] })).toBe('')
    expect(extractContent({ choices: [{ message: {} }] })).toBe('')
    expect(extractContent({ choices: [{ message: { content: 42 } }] })).toBe('')
  })
})

describe('transcribeAudio', () => {
  beforeEach(() => {
    transcribeVoice.mockReset()
  })

  it('calls the server function with the base64 WAV and returns its text', async () => {
    transcribeVoice.mockResolvedValue({
      status: 'ok',
      text: 'any TCL QM8K in stock',
    })
    const text = await transcribeAudio({ wavBase64: 'QUJD' })

    expect(text).toBe('any TCL QM8K in stock')
    expect(transcribeVoice).toHaveBeenCalledWith({
      data: { wavBase64: 'QUJD' },
    })
  })

  it('returns empty string when the model heard nothing', async () => {
    transcribeVoice.mockResolvedValue({ status: 'ok', text: '' })
    await expect(transcribeAudio({ wavBase64: 'QUJD' })).resolves.toBe('')
  })

  it('throws TranscriptionError with the server message on an error value', async () => {
    transcribeVoice.mockResolvedValue({
      status: 'error',
      message: 'Sign in to use voice input',
    })
    const promise = transcribeAudio({ wavBase64: 'QUJD' })
    await expect(promise).rejects.toThrow('Sign in to use voice input')
    await expect(promise).rejects.toBeInstanceOf(TranscriptionError)
  })
})
