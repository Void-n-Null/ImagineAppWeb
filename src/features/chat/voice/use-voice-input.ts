/**
 * Voice input state machine for the composer (IMA-25).
 *
 * idle → recording → transcribing → idle, with the transcript delivered via
 * `onTranscript` (the composer appends it to the draft — never auto-sends).
 * Level samples land in a ref, not state: they arrive ~23x/sec and only the
 * recording meter cares, so it reads them on its own rAF loop instead of
 * re-rendering the whole composer at audio rate.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  isVoiceInputSupported,
  type RecorderHandle,
  startRecording,
} from './recorder'
import { transcribeAudio } from './transcribe'
import { downsample, encodeWav, TARGET_SAMPLE_RATE, toBase64 } from './wav'

export type VoiceState = 'idle' | 'recording' | 'transcribing'

type TimerRef = React.RefObject<ReturnType<typeof setTimeout> | null>

function clearTimer(ref: TimerRef): void {
  if (ref.current !== null) clearTimeout(ref.current)
  ref.current = null
}

/** Hard cap so a forgotten live mic can't grow unbounded; auto-transcribes. */
const MAX_RECORDING_MS = 120_000
/** Anything shorter is a fumbled tap, not speech — discard silently. */
const MIN_RECORDING_MS = 400
/** How many recent level samples the meter can read. */
const LEVEL_HISTORY = 28

export interface UseVoiceInput {
  /** False → render no mic affordance at all. */
  supported: boolean
  state: VoiceState
  error: string | null
  /** Epoch ms when recording started (drive the elapsed clock from this). */
  startedAt: number
  /** Rolling RMS levels, newest last — read from a rAF loop, not render. */
  levelsRef: React.RefObject<number[]>
  start: () => void
  /** Stop recording and transcribe; transcript arrives via onTranscript. */
  finish: () => void
  /** Stop recording and throw the audio away. */
  cancel: () => void
  dismissError: () => void
}

export function useVoiceInput({
  onTranscript,
}: {
  onTranscript: (text: string) => void
}): UseVoiceInput {
  const [supported] = useState(isVoiceInputSupported)
  const [state, setState] = useState<VoiceState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [startedAt, setStartedAt] = useState(0)
  const levelsRef = useRef<number[]>([])
  const handleRef = useRef<RecorderHandle | null>(null)
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const disposedRef = useRef(false)
  const onTranscriptRef = useRef(onTranscript)
  onTranscriptRef.current = onTranscript

  const finish = useCallback(() => {
    const handle = handleRef.current
    if (!handle) return
    handleRef.current = null
    clearTimer(maxTimerRef)
    setState('transcribing')

    void (async () => {
      const { samples, sampleRate, durationMs } = await handle.stop()
      if (durationMs < MIN_RECORDING_MS) return setState('idle')

      const wavBase64 = toBase64(
        encodeWav(downsample(samples, sampleRate), TARGET_SAMPLE_RATE),
      )
      try {
        const text = await transcribeAudio({ wavBase64 })
        if (text.length > 0) onTranscriptRef.current(text)
        else setError('Didn’t catch any speech — try again closer to the mic.')
      } catch {
        // The server function returns error VALUES for auth/rate/config; a
        // throw here is a transport or timeout failure. Either way the user
        // just needs to retry or type it.
        setError('Transcription failed — try again or type it.')
      }
      setState('idle')
    })().catch(() => {
      // stop()/encode blowing up shouldn't strand the transcribing state.
      setError('Transcription failed — try again or type it.')
      setState('idle')
    })
  }, [])

  const start = useCallback(() => {
    if (handleRef.current) return
    setError(null)
    levelsRef.current = []

    // getUserMedia + AudioContext must be kicked off inside this tap.
    void startRecording((rms) => {
      const levels = levelsRef.current
      levels.push(rms)
      if (levels.length > LEVEL_HISTORY) levels.shift()
    })
      .then((handle) => {
        if (disposedRef.current) {
          // Unmounted while the permission prompt was open — release the mic.
          handle.cancel()
          return
        }
        handleRef.current = handle
        setStartedAt(Date.now())
        setState('recording')
        maxTimerRef.current = setTimeout(finish, MAX_RECORDING_MS)
      })
      .catch((cause: unknown) => {
        setError(
          cause instanceof DOMException &&
            (cause.name === 'NotAllowedError' || cause.name === 'SecurityError')
            ? 'Microphone access is blocked — allow it in your browser settings.'
            : 'Couldn’t start the microphone.',
        )
      })
  }, [finish])

  const cancel = useCallback(() => {
    clearTimer(maxTimerRef)
    handleRef.current?.cancel()
    handleRef.current = null
    setState('idle')
  }, [])

  // Unmount with a live mic (thread switch, navigation) → release it.
  useEffect(
    () => () => {
      disposedRef.current = true
      cancel()
    },
    [cancel],
  )

  return {
    supported,
    state,
    error,
    startedAt,
    levelsRef,
    start,
    finish,
    cancel,
    dismissError: useCallback(() => setError(null), []),
  }
}
