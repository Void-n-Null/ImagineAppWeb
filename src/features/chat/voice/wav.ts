/**
 * PCM → WAV plumbing for voice input (IMA-25).
 *
 * The recorder captures raw Float32 PCM off an AudioWorklet (no MediaRecorder
 * — its container/codec varies per browser: webm/opus on Chrome, mp4/aac on
 * iOS Safari). Encoding a 16 kHz mono 16-bit WAV ourselves sidesteps codec
 * roulette entirely: every browser produces byte-identical output, and WAV is
 * universally accepted by OpenRouter's `input_audio` content type.
 *
 * 16 kHz is the speech-recognition standard rate — going higher only inflates
 * the upload (48 kHz would triple it for zero transcription-quality gain).
 */

export const TARGET_SAMPLE_RATE = 16000

/** Concatenate captured worklet chunks into one buffer. */
export function mergeChunks(chunks: readonly Float32Array[]): Float32Array {
  let total = 0
  for (const chunk of chunks) total += chunk.length
  const merged = new Float32Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.length
  }
  return merged
}

/**
 * Linear-interpolation resample. Plenty for speech → transcription; a
 * windowed-sinc filter would be audiophile theater here. Never upsamples —
 * if the source rate is already at/below target, samples pass through.
 */
export function downsample(
  samples: Float32Array,
  fromRate: number,
  toRate: number = TARGET_SAMPLE_RATE,
): Float32Array {
  if (fromRate <= toRate || samples.length === 0) return samples
  const ratio = fromRate / toRate
  const outLength = Math.floor(samples.length / ratio)
  const out = new Float32Array(outLength)
  for (let i = 0; i < outLength; i++) {
    const position = i * ratio
    const left = Math.floor(position)
    const right = Math.min(left + 1, samples.length - 1)
    const t = position - left
    out[i] = samples[left] * (1 - t) + samples[right] * t
  }
  return out
}

/** Encode mono float PCM as a 16-bit WAV file. */
export function encodeWav(
  samples: Float32Array,
  sampleRate: number,
): Uint8Array {
  const dataLength = samples.length * 2
  const buffer = new ArrayBuffer(44 + dataLength)
  const view = new DataView(buffer)

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i))
    }
  }

  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + dataLength, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true) // fmt subchunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  writeAscii(36, 'data')
  view.setUint32(40, dataLength, true)

  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, Math.round(clamped * 32767), true)
  }

  return new Uint8Array(buffer)
}

/** Base64-encode bytes, chunked so String.fromCharCode never blows the stack. */
export function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}
