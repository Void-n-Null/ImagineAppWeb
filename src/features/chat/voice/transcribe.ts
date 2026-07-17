/**
 * Audio → text on the app's pool key (IMA-25; server-side since IMA-17 #357).
 *
 * Engine decision: recorded-audio transcription via an audio-capable model
 * beats the Web Speech API for this app — Web Speech is unreliable on iOS
 * Safari (the coworker fleet is iPhone-first, IMA-15) and pipes audio to a
 * vendor the user never chose. This path gives consistent quality on every
 * browser and handles store-floor noise better. Trade-off accepted: no live
 * interim text, ~a beat of latency after stop.
 *
 * Phase 2 (IMA-17): the OpenRouter call moved server-side (the pool key can't
 * ship to browsers). This module keeps the PURE pieces the server function
 * reuses — the model id, the prompt, and extractContent — and exposes a thin
 * client `transcribeAudio` that calls the transcribeVoice server function. No
 * OpenRouter key is involved client-side anymore.
 */

import { transcribeVoice } from '#/server/functions/transcribe-voice'

/**
 * Fixed transcription engine, independent of the selected chat model (which
 * may not accept audio at all). Gemini Flash: audio-capable, fast, strong on
 * noisy speech, and cheap enough to be a non-decision (~32 tokens/sec of
 * audio — a 30 s clip costs a fraction of a cent).
 */
export const TRANSCRIPTION_MODEL = 'google/gemini-2.5-flash'

/** The transcription instruction. Exported so the server function reuses the
 *  exact same prompt the client authored (IMA-17). */
export const TRANSCRIPTION_PROMPT = [
  'Transcribe the speech in this audio recording exactly as spoken.',
  'Context: a retail employee on a Best Buy sales floor dictating a question',
  'about products — expect brand names, model numbers, and SKUs spoken aloud',
  '(e.g. "TCL QM8K", "RTX 4070", "SKU 6537363").',
  'Output only the transcribed text with normal punctuation and capitalization.',
  'No commentary, no labels, no quotation marks.',
  'If there is no intelligible speech, output nothing at all.',
].join(' ')

/** Raised when the transcription server function returns an error value, so
 *  the caller can distinguish a failed transcription from a bug. */
export class TranscriptionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TranscriptionError'
  }
}

export interface TranscribeOptions {
  /** Base64-encoded WAV (see wav.ts). */
  wavBase64: string
}

/** Extract assistant text whether content is a string or content-part array. */
export function extractContent(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null) return ''
  const choices = (payload as { choices?: unknown }).choices
  if (!Array.isArray(choices)) return ''
  const first = choices[0] as { message?: { content?: unknown } } | undefined
  const content = first?.message?.content
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof (part as { text?: unknown })?.text === 'string'
          ? (part as { text: string }).text
          : '',
      )
      .join('')
      .trim()
  }
  return ''
}

/**
 * Transcribe a base64 WAV via the server function (which holds the pool key,
 * enforces auth + rate limits, and calls OpenRouter). Returns the trimmed
 * transcript ('' when the model heard nothing usable). Throws
 * TranscriptionError with a human-readable message on failure.
 */
export async function transcribeAudio(
  options: TranscribeOptions,
): Promise<string> {
  const result = await transcribeVoice({
    data: { wavBase64: options.wavBase64 },
  })
  if (result.status === 'error') throw new TranscriptionError(result.message)
  return result.text
}
