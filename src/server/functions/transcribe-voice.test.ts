import { describe, expect, it } from 'vitest'
import {
  buildTranscriptionRequestBody,
  validateTranscribeInput,
} from './transcribe-voice'

/**
 * Guards the untrusted voice payload before any model spend (IMA-17 #357).
 * The transcription call itself (auth → rate-limit → OpenRouter) runs on the
 * server pool key and isn't unit-tested here; this locks the size/shape gate.
 */
describe('validateTranscribeInput', () => {
  it('accepts a base64 WAV string', () => {
    expect(validateTranscribeInput({ wavBase64: 'QUJD' })).toEqual({
      wavBase64: 'QUJD',
    })
  })

  it('rejects a missing wavBase64', () => {
    expect(() => validateTranscribeInput({})).toThrow(/base64 WAV/)
    expect(() => validateTranscribeInput(null)).toThrow(/base64 WAV/)
  })

  it('rejects a non-string wavBase64', () => {
    expect(() => validateTranscribeInput({ wavBase64: 123 })).toThrow(
      /base64 WAV/,
    )
  })

  it('rejects an empty wavBase64', () => {
    expect(() => validateTranscribeInput({ wavBase64: '' })).toThrow(
      /base64 WAV/,
    )
  })

  it('rejects an oversized recording (> ~10 MB base64)', () => {
    const huge = 'A'.repeat(10_000_001)
    expect(() => validateTranscribeInput({ wavBase64: huge })).toThrow(
      /too large/,
    )
  })
})

describe('buildTranscriptionRequestBody', () => {
  it('restricts to no-retention / no-training providers (Best Buy ToS)', () => {
    const body = buildTranscriptionRequestBody('QUJD')
    // Recorded floor speech + Best Buy product identifiers in the prompt must
    // not be retained or trained on: deny data collection AND require ZDR.
    expect(body.provider).toEqual({ data_collection: 'deny', zdr: true })
  })

  it('carries the WAV as an input_audio content part', () => {
    const body = buildTranscriptionRequestBody('QUJD')
    const messages = body.messages as { content: Record<string, unknown>[] }[]
    expect(messages[0]?.content).toContainEqual({
      type: 'input_audio',
      input_audio: { data: 'QUJD', format: 'wav' },
    })
  })
})
