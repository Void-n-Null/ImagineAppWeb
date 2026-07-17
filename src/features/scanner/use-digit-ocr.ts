import { useCallback, useEffect, useRef, useState } from 'react'
import { extractDigitCandidates } from '#/lib/ocr-digits'

/**
 * On-demand digit OCR for the scanner (IMA-39). The associate points the camera
 * at any printed/displayed number — a SKU on a monitor, a fact tag, a pick
 * list, bestbuy.com on a phone — taps "Read a number", and this hook runs ONE
 * Tesseract pass over the current frame and returns ranked digit candidates
 * that flow into the SAME `lookupScannedProduct` pipeline as a barcode scan.
 *
 * Cost discipline:
 * - Zero API cost: everything runs on-device.
 * - No always-on OCR (battery): a pass happens only when `read()` is called.
 * - The tesseract.js payload (~few MB of wasm) is behind a dynamic import, so
 *   it never lands in the main bundle — it's fetched on first `read()` only.
 * - The worker (and its loaded traineddata — the expensive part) is created
 *   lazily and kept alive across reads; it's terminated on unmount.
 */

export type DigitOcrStatus = 'idle' | 'loading' | 'reading'

export interface UseDigitOcr {
  status: DigitOcrStatus
  /** Run one OCR pass on the current video frame → ranked digit candidates. */
  read: (video: HTMLVideoElement) => Promise<string[]>
}

// Minimal shape of the tesseract worker we use — avoids importing the type
// eagerly (which would be fine, types erase, but keeps this file dependency-lean
// and the surface honest about exactly what we call).
interface OcrWorker {
  setParameters(params: Record<string, unknown>): Promise<unknown>
  recognize(image: HTMLCanvasElement): Promise<{ data: { text: string } }>
  terminate(): Promise<unknown>
}

/** Self-hosted asset paths (vendored by scripts/sync-tesseract-assets.ts). */
const WORKER_PATH = '/tesseract/worker.min.js'
const CORE_PATH = '/tesseract/core' // directory; getCore picks the SIMD/LSTM variant
/** Local traineddata dir (eng.traineddata.gz, ~2.9 MB, from the lockfile-pinned
 *  `@tesseract.js-data/eng` best_int model). Guaranteed present: the prebuild
 *  sync script fails the build if it can't vendor it. */
const LANG_PATH = '/tessdata'

/**
 * Center crop of the frame passed to OCR — roughly the region the reticle
 * guides the associate to aim at (the reticle is 4/5 wide × 2/5 tall). A
 * slightly taller/wider window than the reticle tolerates imperfect aim while
 * still excluding surrounding tag clutter that inflates false digit runs.
 */
const CROP_W = 0.7
const CROP_H = 0.5

export function useDigitOcr(): UseDigitOcr {
  const [status, setStatus] = useState<DigitOcrStatus>('idle')

  const workerRef = useRef<OcrWorker | null>(null)
  // In-flight worker creation, so concurrent first reads share one worker.
  const workerInitRef = useRef<Promise<OcrWorker> | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const readingRef = useRef(false)
  const unmountedRef = useRef(false)

  const ensureWorker = useCallback(async (): Promise<OcrWorker> => {
    if (workerRef.current) return workerRef.current
    if (workerInitRef.current) return workerInitRef.current

    workerInitRef.current = (async () => {
      // Dynamic import: the multi-MB tesseract payload is fetched only now,
      // on the first read — never in the main bundle.
      const { createWorker, OEM, PSM } = await import('tesseract.js')
      const worker = (await createWorker('eng', OEM.LSTM_ONLY, {
        workerPath: WORKER_PATH,
        corePath: CORE_PATH,
        langPath: LANG_PATH,
        // Load .gz traineddata (matches the vendored eng.traineddata.gz) and
        // cache it in IndexedDB so subsequent sessions skip the fetch/parse.
        gzip: true,
        cacheMethod: 'write',
      })) as unknown as OcrWorker

      await worker.setParameters({
        tessedit_char_whitelist: '0123456789',
        // Sparse text: digits scattered across a tag / screen, not a paragraph.
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      })

      // If we were unmounted mid-init, don't leak the worker.
      if (unmountedRef.current) {
        void worker.terminate()
        throw new Error('unmounted')
      }
      workerRef.current = worker
      return worker
    })()

    try {
      return await workerInitRef.current
    } finally {
      workerInitRef.current = null
    }
  }, [])

  const read = useCallback(
    async (video: HTMLVideoElement): Promise<string[]> => {
      // Concurrency guard: collapse overlapping reads.
      if (readingRef.current) return []
      const vw = video.videoWidth
      const vh = video.videoHeight
      if (vw === 0 || vh === 0) return []

      readingRef.current = true
      const firstUse = workerRef.current === null
      setStatus(firstUse ? 'loading' : 'reading')
      try {
        const worker = await ensureWorker()
        if (unmountedRef.current) return []
        setStatus('reading')

        // Draw the center crop to an offscreen canvas.
        const cropW = Math.round(vw * CROP_W)
        const cropH = Math.round(vh * CROP_H)
        const sx = Math.round((vw - cropW) / 2)
        const sy = Math.round((vh - cropH) / 2)

        if (canvasRef.current === null) {
          canvasRef.current = document.createElement('canvas')
        }
        const canvas = canvasRef.current
        canvas.width = cropW
        canvas.height = cropH
        const ctx = canvas.getContext('2d')
        if (!ctx) return []
        ctx.drawImage(video, sx, sy, cropW, cropH, 0, 0, cropW, cropH)

        const result = await worker.recognize(canvas)
        if (unmountedRef.current) return []
        return extractDigitCandidates(result.data.text)
      } catch {
        // A failed pass yields no candidates; the UI shows "no number found".
        return []
      } finally {
        readingRef.current = false
        if (!unmountedRef.current) setStatus('idle')
      }
    },
    [ensureWorker],
  )

  useEffect(() => {
    unmountedRef.current = false
    return () => {
      unmountedRef.current = true
      const worker = workerRef.current
      workerRef.current = null
      if (worker) void worker.terminate()
    }
  }, [])

  return { status, read }
}
