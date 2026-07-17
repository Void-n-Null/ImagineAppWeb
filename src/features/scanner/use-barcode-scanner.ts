import {
  BarcodeDetector,
  type BarcodeFormat,
  type DetectedBarcode,
  setZXingModuleOverrides,
} from 'barcode-detector/ponyfill'
import { useCallback, useEffect, useRef, useState } from 'react'
// Self-hosted from our own origin: Vite fingerprints the wasm shipped with the
// installed zxing-wasm version, so it can never drift from the JS that loads it
// (the library otherwise fetches it from a jsDelivr CDN at runtime).
import zxingWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'

// Point the ZXing loader at our bundled copy. Idempotent, module-scoped so it
// runs exactly once before any detector is constructed.
setZXingModuleOverrides({ locateFile: () => zxingWasmUrl })

/**
 * Retail-floor symbologies (v1 scanned all of them, so we match its coverage):
 * - `qr_code` — bby.us LMD tags + bestbuy.com spec QRs.
 * - `ean_13` / `ean_8` / `upc_a` / `upc_e` — product-box barcodes.
 * - `code_128` — modern shelf tags encoding a bare SKU.
 * - `code_39` / `itf` — legacy shelf tags and shipping cartons (ITF/GTIN-14).
 * - `data_matrix` — small-device labels where a linear barcode won't fit.
 * All strings are verified `barcode-detector` (zxing-wasm v3) BarcodeFormat
 * members; `itf` is the package's name for Interleaved 2 of 5 (not `itf14`).
 */
export const SCANNER_FORMATS: BarcodeFormat[] = [
  'qr_code',
  'ean_13',
  'ean_8',
  'upc_a',
  'upc_e',
  'code_128',
  'code_39',
  'itf',
  'data_matrix',
]

export type ScannerStatus =
  | 'idle'
  | 'starting'
  | 'scanning'
  | 'paused'
  | 'stopped'
  | 'error'

export interface ScanResult {
  rawValue: string
  format: string
  at: number
}

// `torch` is a real MediaStreamTrack capability/constraint but isn't in the
// standard DOM lib yet — narrow extensions avoid a bare `any`.
interface TorchCapabilities extends MediaTrackCapabilities {
  torch?: boolean
}
interface TorchConstraintSet extends MediaTrackConstraintSet {
  torch?: boolean
}

export interface UseBarcodeScannerOptions {
  onScan?: (result: ScanResult) => void
  formats?: BarcodeFormat[]
  scanIntervalMs?: number
  /** Ignore an identical rawValue seen again within this window (ms). */
  dedupeWindowMs?: number
  /** Acquire the camera automatically on mount (page → camera, no button). */
  autoStart?: boolean
}

export interface UseBarcodeScanner {
  videoRef: React.RefObject<HTMLVideoElement | null>
  status: ScannerStatus
  error: string | null
  lastResult: ScanResult | null
  torchSupported: boolean
  torchOn: boolean
  start: () => Promise<void>
  stop: () => void
  toggleTorch: () => Promise<void>
}

export function useBarcodeScanner(
  options: UseBarcodeScannerOptions = {},
): UseBarcodeScanner {
  const {
    onScan,
    formats = SCANNER_FORMATS,
    scanIntervalMs = 150,
    dedupeWindowMs = 1500,
    autoStart = false,
  } = options

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const detectorRef = useRef<BarcodeDetector | null>(null)
  const loopRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const inFlightRef = useRef(false)
  const lastHitRef = useRef<{ value: string; at: number } | null>(null)
  // Monotonic token: every start()/stop() bumps it so an in-flight async start
  // (awaiting getUserMedia) can detect it was superseded — e.g. React's dev
  // double-mount (setup → cleanup → setup) — and clean up instead of leaking a
  // camera track or flashing a stale error.
  const genRef = useRef(0)

  // Keep the latest onScan without re-subscribing the loop each render.
  const onScanRef = useRef(onScan)
  useEffect(() => {
    onScanRef.current = onScan
  }, [onScan])

  const [status, setStatus] = useState<ScannerStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<ScanResult | null>(null)
  const [torchSupported, setTorchSupported] = useState(false)
  const [torchOn, setTorchOn] = useState(false)

  const clearLoop = useCallback(() => {
    if (loopRef.current !== null) {
      clearInterval(loopRef.current)
      loopRef.current = null
    }
  }, [])

  const tick = useCallback(async () => {
    const video = videoRef.current
    const detector = detectorRef.current
    if (!video || !detector || inFlightRef.current) return
    if (video.readyState < 2 || video.videoWidth === 0) return

    inFlightRef.current = true
    try {
      const found: DetectedBarcode[] = await detector.detect(video)
      if (found.length === 0) return
      const hit = found[0]
      const now = Date.now()
      const prev = lastHitRef.current
      if (
        prev &&
        prev.value === hit.rawValue &&
        now - prev.at < dedupeWindowMs
      ) {
        return
      }
      lastHitRef.current = { value: hit.rawValue, at: now }
      const result: ScanResult = {
        rawValue: hit.rawValue,
        format: hit.format,
        at: now,
      }
      setLastResult(result)
      onScanRef.current?.(result)
    } catch {
      // Transient decode failures are expected between frames; ignore.
    } finally {
      inFlightRef.current = false
    }
  }, [dedupeWindowMs])

  const startLoop = useCallback(() => {
    clearLoop()
    loopRef.current = setInterval(() => void tick(), scanIntervalMs)
    setStatus('scanning')
  }, [clearLoop, scanIntervalMs, tick])

  const stop = useCallback(() => {
    genRef.current += 1
    clearLoop()
    inFlightRef.current = false
    const stream = streamRef.current
    if (stream) {
      for (const track of stream.getTracks()) track.stop()
      streamRef.current = null
    }
    if (videoRef.current) videoRef.current.srcObject = null
    setTorchOn(false)
    setTorchSupported(false)
    setStatus('stopped')
  }, [clearLoop])

  const start = useCallback(async () => {
    setError(null)
    if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setStatus('error')
      setError(
        'Camera needs a secure context (HTTPS or localhost). Open the app over its HTTPS URL.',
      )
      return
    }

    // Tear down any prior stream so a re-start never leaks a live camera track.
    genRef.current += 1
    const gen = genRef.current
    clearLoop()
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop()
      streamRef.current = null
    }

    setStatus('starting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      })
      // Superseded while awaiting the permission prompt (e.g. dev double-mount
      // ran cleanup, or the user navigated away): discard this stream.
      if (gen !== genRef.current) {
        for (const track of stream.getTracks()) track.stop()
        return
      }
      streamRef.current = stream

      const video = videoRef.current
      if (!video) {
        for (const track of stream.getTracks()) track.stop()
        streamRef.current = null
        setStatus('error')
        setError('Video element not mounted.')
        return
      }
      video.srcObject = stream
      video.setAttribute('playsinline', 'true')
      video.muted = true
      video.autoplay = true
      // play() can reject when the user-activation token was spent granting the
      // camera permission during the getUserMedia await. That's non-fatal: the
      // autoplay attribute plus a one-shot canplay retry starts playback without
      // requiring a second tap. Only real camera failures should surface as errors.
      try {
        await video.play()
      } catch {
        video.addEventListener(
          'canplay',
          () => void video.play().catch(() => {}),
          {
            once: true,
          },
        )
      }

      if (gen !== genRef.current) return

      const [track] = stream.getVideoTracks()
      const caps = track?.getCapabilities?.() as TorchCapabilities | undefined
      setTorchSupported(Boolean(caps?.torch))

      if (!detectorRef.current) {
        detectorRef.current = new BarcodeDetector({ formats })
      }

      startLoop()
    } catch (err) {
      // Don't report an error from a start that was already superseded.
      if (gen !== genRef.current) return
      streamRef.current = null
      setStatus('error')
      setError(describeCameraError(err))
    }
  }, [clearLoop, formats, startLoop])

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    const caps = track.getCapabilities?.() as TorchCapabilities | undefined
    if (!caps?.torch) return
    const next = !torchOn
    try {
      await track.applyConstraints({
        advanced: [{ torch: next } as TorchConstraintSet],
      })
      setTorchOn(next)
    } catch {
      // Some devices reject torch mid-stream; leave state unchanged.
    }
  }, [torchOn])

  // PWA/standalone quirk: after backgrounding, iOS Safari freezes the camera
  // track. Pause the loop when hidden; on return, re-play and, if the track has
  // died, re-acquire the stream.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (loopRef.current !== null) {
          clearLoop()
          setStatus((s) => (s === 'scanning' ? 'paused' : s))
        }
        return
      }
      // visible again
      if (status !== 'paused' && status !== 'scanning') return
      const stream = streamRef.current
      const track = stream?.getVideoTracks()[0]
      if (!stream || !track || track.readyState === 'ended') {
        void start()
        return
      }
      const video = videoRef.current
      if (video) void video.play().catch(() => void start())
      startLoop()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [clearLoop, start, startLoop, status])

  // Auto-start on mount when requested; always tear down on unmount. The
  // generation guard in start()/stop() makes the dev double-mount safe.
  useEffect(() => {
    if (autoStart) void start()
    return stop
  }, [autoStart, start, stop])

  return {
    videoRef,
    status,
    error,
    lastResult,
    torchSupported,
    torchOn,
    start,
    stop,
    toggleTorch,
  }
}

function describeCameraError(err: unknown): string {
  if (err instanceof DOMException) {
    switch (err.name) {
      case 'NotAllowedError':
        return 'Camera permission denied. Allow camera access and try again.'
      case 'NotFoundError':
        return 'No camera found on this device.'
      case 'NotReadableError':
        return 'Camera is in use by another app.'
      case 'OverconstrainedError':
        return 'No camera matched the requested settings.'
      default:
        return `Camera error: ${err.name}`
    }
  }
  return err instanceof Error ? err.message : 'Unknown camera error.'
}
