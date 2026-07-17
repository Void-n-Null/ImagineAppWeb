import { describe, expect, it } from 'vitest'
import {
  downsample,
  encodeWav,
  mergeChunks,
  TARGET_SAMPLE_RATE,
  toBase64,
} from './wav'

describe('mergeChunks', () => {
  it('concatenates chunks in order', () => {
    const merged = mergeChunks([
      new Float32Array([1, 2]),
      new Float32Array([]),
      new Float32Array([3]),
    ])
    expect([...merged]).toEqual([1, 2, 3])
  })

  it('handles zero chunks', () => {
    expect(mergeChunks([]).length).toBe(0)
  })
})

describe('downsample', () => {
  it('halves the sample count for a 2:1 rate ratio', () => {
    const input = new Float32Array(32000)
    const out = downsample(input, 32000, 16000)
    expect(out.length).toBe(16000)
  })

  it('interpolates between neighbours', () => {
    // 2:1 — output[1] lands exactly between input[2]=0.2 and... exactly on
    // input[2]. Use 4:3 to force a fractional position.
    const out = downsample(new Float32Array([0, 1, 0, 1]), 4, 3)
    expect(out.length).toBe(3)
    expect(out[0]).toBe(0)
    expect(out[1]).toBeCloseTo(1 - 1 / 3, 5) // position 4/3 between 1 and 0
  })

  it('passes through when already at or below the target rate', () => {
    const input = new Float32Array([0.5, -0.5])
    expect(downsample(input, 16000)).toBe(input)
    expect(downsample(input, 8000)).toBe(input)
  })

  it('defaults to the 16 kHz speech rate', () => {
    const out = downsample(new Float32Array(48000), 48000)
    expect(out.length).toBe(TARGET_SAMPLE_RATE)
  })
})

describe('encodeWav', () => {
  const ascii = (bytes: Uint8Array, start: number, length: number) =>
    String.fromCharCode(...bytes.subarray(start, start + length))

  it('writes a valid 16-bit mono PCM header', () => {
    const wav = encodeWav(new Float32Array(100), 16000)
    const view = new DataView(wav.buffer)

    expect(wav.length).toBe(44 + 200)
    expect(ascii(wav, 0, 4)).toBe('RIFF')
    expect(view.getUint32(4, true)).toBe(36 + 200)
    expect(ascii(wav, 8, 4)).toBe('WAVE')
    expect(ascii(wav, 12, 4)).toBe('fmt ')
    expect(view.getUint16(20, true)).toBe(1) // PCM
    expect(view.getUint16(22, true)).toBe(1) // mono
    expect(view.getUint32(24, true)).toBe(16000)
    expect(view.getUint32(28, true)).toBe(32000) // byte rate
    expect(view.getUint16(32, true)).toBe(2) // block align
    expect(view.getUint16(34, true)).toBe(16) // bit depth
    expect(ascii(wav, 36, 4)).toBe('data')
    expect(view.getUint32(40, true)).toBe(200)
  })

  it('scales and clips samples to int16', () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 2, -2, 0.5]), 16000)
    const view = new DataView(wav.buffer)
    expect(view.getInt16(44, true)).toBe(0)
    expect(view.getInt16(46, true)).toBe(32767)
    expect(view.getInt16(48, true)).toBe(-32767)
    expect(view.getInt16(50, true)).toBe(32767) // clipped
    expect(view.getInt16(52, true)).toBe(-32767) // clipped
    expect(view.getInt16(54, true)).toBe(Math.round(0.5 * 32767))
  })
})

describe('toBase64', () => {
  it('round-trips through atob', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255])
    const decoded = atob(toBase64(bytes))
    expect([...decoded].map((c) => c.charCodeAt(0))).toEqual([
      0, 1, 2, 250, 255,
    ])
  })

  it('survives buffers larger than one fromCharCode chunk', () => {
    const bytes = new Uint8Array(0x8000 * 2 + 17).fill(65)
    const encoded = toBase64(bytes)
    expect(atob(encoded).length).toBe(bytes.length)
  })
})
