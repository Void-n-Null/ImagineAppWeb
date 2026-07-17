/**
 * Microphone capture for voice input (IMA-25).
 *
 * getUserMedia → AudioWorklet posting raw Float32 PCM batches to the main
 * thread. No MediaRecorder (see wav.ts for why). The worklet outputs silence
 * — it's connected to the destination only because processors must sit in a
 * rendering graph to run; nothing echoes to the speakers.
 *
 * Everything here must be called from a user gesture: iOS Safari only allows
 * AudioContext creation/resume and the mic permission prompt inside one,
 * which also satisfies the "no prompt on page load" rule.
 */

/** Worklet source, inlined via Blob URL so no build/asset wiring is needed. */
const WORKLET_SOURCE = `
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buffer = new Float32Array(2048)
    this.length = 0
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (!channel) return true
    let read = 0
    while (read < channel.length) {
      const space = this.buffer.length - this.length
      const take = Math.min(space, channel.length - read)
      this.buffer.set(channel.subarray(read, read + take), this.length)
      this.length += take
      read += take
      if (this.length === this.buffer.length) {
        this.port.postMessage(this.buffer)
        this.buffer = new Float32Array(2048)
        this.length = 0
      }
    }
    return true
  }
}
registerProcessor('pcm-capture', PcmCapture)
`

import { mergeChunks } from './wav'

export interface RecordingResult {
  samples: Float32Array
  sampleRate: number
  /** Recorded duration in milliseconds (sample-derived, not wall-clock). */
  durationMs: number
}

export interface RecorderHandle {
  /** Stop capture, release the mic, and hand back the PCM. */
  stop(): Promise<RecordingResult>
  /** Stop capture and discard everything. */
  cancel(): void
}

/** No mic button at all when the platform can't record. */
export function isVoiceInputSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof AudioWorkletNode !== 'undefined'
  )
}

/**
 * Request the mic and start capturing. Rejects with the getUserMedia error
 * (NotAllowedError etc.) — the caller translates that into UI copy.
 *
 * `onLevel` receives the RMS level (0..~1) of each PCM batch, ~23x/sec at
 * 48 kHz — drive the recording meter from it.
 */
export async function startRecording(
  onLevel?: (rms: number) => void,
): Promise<RecorderHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  })

  const context = new AudioContext()
  const workletUrl = URL.createObjectURL(
    new Blob([WORKLET_SOURCE], { type: 'application/javascript' }),
  )
  const chunks: Float32Array[] = []

  const releaseHardware = () => {
    for (const track of stream.getTracks()) track.stop()
    void context.close().catch(() => {})
    URL.revokeObjectURL(workletUrl)
  }

  try {
    await context.audioWorklet.addModule(workletUrl)
  } catch (error) {
    releaseHardware()
    throw error
  }

  const source = context.createMediaStreamSource(stream)
  const capture = new AudioWorkletNode(context, 'pcm-capture', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  })
  capture.port.onmessage = (event: MessageEvent<Float32Array>) => {
    const batch = event.data
    chunks.push(batch)
    if (onLevel) {
      let sum = 0
      for (let i = 0; i < batch.length; i++) sum += batch[i] * batch[i]
      onLevel(Math.sqrt(sum / batch.length))
    }
  }
  source.connect(capture)
  capture.connect(context.destination) // silent output; keeps the graph live

  let finished = false
  const teardown = () => {
    if (finished) return
    finished = true
    capture.port.onmessage = null
    source.disconnect()
    capture.disconnect()
    releaseHardware()
  }

  const sampleRate = context.sampleRate

  return {
    async stop() {
      teardown()
      const samples = mergeChunks(chunks)
      return {
        samples,
        sampleRate,
        durationMs: (samples.length / sampleRate) * 1000,
      }
    },
    cancel() {
      teardown()
      chunks.length = 0
    },
  }
}
