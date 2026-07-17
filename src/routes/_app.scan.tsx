import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { BestBuyAttribution } from '#/features/about/bestbuy-attribution'
import { capture } from '#/features/analytics/analytics'
import { CompareStrip } from '#/features/comparison/compare-strip'
import { addCompareEntry } from '#/features/comparison/compare-tray'
import { BarcodeScanner } from '#/features/scanner/barcode-scanner'
import {
  feedbackForResult,
  NETWORK_FEEDBACK,
  type ScanFeedback,
  ScanFeedbackPill,
} from '#/features/scanner/scan-feedback'
import { recordScan, useScanHistory } from '#/features/scanner/scan-history'
import { getScanMode, useScanMode } from '#/features/scanner/scan-mode'
import { ScanModeToggle } from '#/features/scanner/scan-mode-toggle'
import { ScanHistoryRow } from '#/features/scanner/scan-result-card'
import type { ScanResult } from '#/features/scanner/use-barcode-scanner'
import { useDigitOcr } from '#/features/scanner/use-digit-ocr'
import { pickAutoCandidate } from '#/lib/ocr-digits'
import { lookupScannedProduct } from '#/server/functions/lookup-scanned-product'

export const Route = createFileRoute('/_app/scan')({ component: ScanPage })

/**
 * How long a successful auto-navigation suppresses re-navigating for the SAME
 * payload once the user returns to the scanner. v1 only reset its dedupe after
 * you left the detail page; this window (on TOP of the scanner hook's 1500ms
 * frame dedupe) keeps the camera from bouncing you straight back out the moment
 * it re-reads the box you just came back to look past.
 */
const RENAV_SUPPRESS_MS = 5000

/**
 * After a FAILURE (unrecognized / not-found / error) the same code may be
 * retried quickly — the read may have been partial, or a rate limit may have
 * cleared. v1 used a ~1s cooldown so the failure pill doesn't re-fire every
 * frame while the user re-aims at the same tag.
 */
const FAILURE_COOLDOWN_MS = 1000

/** How long the failure pill stays up before auto-dismissing. */
const FEEDBACK_TTL_MS = 2500

/** Idle gap between OCR passes. Recognition itself takes a few hundred ms on a
 *  phone, so the effective cadence is ~1-2 passes/sec — enough to feel instant
 *  when a number drifts into frame without pinning a core. */
const OCR_PASS_GAP_MS = 350

/** When nothing is readable (camera not live, tab hidden), poll lazily. */
const OCR_IDLE_GAP_MS = 600

/** Back-off after a lookup ERROR (rate limit / network) before OCR tries any
 *  lookup again — errors are transient, so the payload is NOT blacklisted. */
const OCR_ERROR_BACKOFF_MS = 4000

type LastAction =
  | { kind: 'navigated'; payload: string; at: number }
  | { kind: 'collected'; payload: string; at: number }
  | { kind: 'failed'; payload: string; at: number }

/**
 * Module-scoped so it survives this route unmounting on auto-navigate: the
 * whole point of re-scan suppression is that returning to /scan (which remounts
 * the component) must NOT immediately re-navigate for the code we just acted on.
 */
let lastAction: LastAction | null = null

function payloadKey(rawValue: string, format: string): string {
  return `${format}:${rawValue}`
}

/** Scanner (IMA-34 + IMA-36): camera → product. What a FOUND scan does is the
 *  segmented mode toggle's call — Detail pushes the product page (v1 parity),
 *  Chat jumps into the assistant with the product attached, Compare chips it
 *  into the tray and stays on camera. Everything else surfaces near the
 *  reticle without leaving the camera, and lands in a persisted history of
 *  compact product cards. */
function ScanPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const history = useScanHistory()
  const scanMode = useScanMode()

  const [feedback, setFeedback] = useState<ScanFeedback | null>(null)
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showFeedback = useCallback((next: ScanFeedback) => {
    setFeedback(next)
    if (feedbackTimer.current !== null) clearTimeout(feedbackTimer.current)
    feedbackTimer.current = setTimeout(() => setFeedback(null), FEEDBACK_TTL_MS)
  }, [])

  useEffect(
    () => () => {
      if (feedbackTimer.current !== null) clearTimeout(feedbackTimer.current)
    },
    [],
  )

  /**
   * The one code path a resolved payload takes, whether it came from the
   * barcode detector or the digit-OCR loop (IMA-39): apply re-scan suppression,
   * resolve the lookup (shared cache with the history rows), then navigate on
   * found or surface the feedback pill on anything else.
   *
   * OCR-sourced payloads differ in two ways (`opts.fromOcr`):
   * - they're recorded in history only when FOUND — the loop fires on every
   *   plausible read, and a wall of misread-digit rows is noise;
   * - the pill includes the digits, so the associate can see a near-miss read
   *   ("6636933 — Not in the Best Buy catalog") and re-aim instead of wondering.
   *
   * Returns the outcome so the OCR loop can blacklist genuine misses but only
   * back off (not blacklist) on transient errors.
   */
  const resolveAndAct = useCallback(
    async (
      rawValue: string,
      format: string,
      at: number,
      opts?: { fromOcr?: boolean },
    ): Promise<'navigated' | 'collected' | 'miss' | 'error' | 'skipped'> => {
      if (!opts?.fromOcr) {
        // Persist first: for a deliberate barcode scan the raw payload is the
        // record, independent of how the lookup resolves.
        recordScan({ rawValue, format, at })
      }

      const key = payloadKey(rawValue, format)
      const now = Date.now()
      const prev = lastAction
      if (prev && prev.payload === key) {
        const elapsed = now - prev.at
        // Same code we just navigated for — stay put until it goes stale.
        // Same window for a Compare-mode collect: the camera is still on the
        // box we just chipped, and re-firing every decode would thrash the
        // "already in this comparison" pill.
        if (
          (prev.kind === 'navigated' || prev.kind === 'collected') &&
          elapsed < RENAV_SUPPRESS_MS
        ) {
          return 'skipped'
        }
        // Same code we just failed on — hold off re-firing the pill briefly.
        if (prev.kind === 'failed' && elapsed < FAILURE_COOLDOWN_MS) {
          return 'skipped'
        }
      }

      try {
        // Same key + staleTime as the history rows: the lookup is resolved
        // once and shared, so the row this scan just created repaints from
        // cache instead of issuing a second request.
        const lookup = await queryClient.fetchQuery({
          queryKey: ['scan-lookup', format, rawValue],
          queryFn: () => lookupScannedProduct({ data: { rawValue, format } }),
          staleTime: Number.POSITIVE_INFINITY,
        })

        if (lookup.status === 'found') {
          if (opts?.fromOcr) recordScan({ rawValue, format, at })

          // Scan mode (IMA-36): what "found" DOES. Read at act time (not a
          // hook dep) so the OCR loop's ref'd callback always sees the
          // current toggle without remounting.
          const mode = getScanMode()
          capture('scan_used', {
            format,
            mode,
            sku: lookup.product.sku,
          })

          if (mode === 'compare') {
            // Stay on the camera; the product chips into the compare tray.
            lastAction = { kind: 'collected', payload: key, at: Date.now() }
            const added = addCompareEntry(lookup.product)
            showFeedback({
              tone: 'ok',
              message: added
                ? 'Added to compare'
                : 'Already in this comparison',
            })
            return 'collected'
          }

          lastAction = { kind: 'navigated', payload: key, at: Date.now() }
          if (mode === 'chat') {
            // Same deep link the detail page's "Ask assistant" uses: fresh
            // thread with the product pre-attached via ?sku=.
            void navigate({ to: '/chat', search: { sku: lookup.product.sku } })
          } else {
            void navigate({
              to: '/product/$sku',
              params: { sku: String(lookup.product.sku) },
            })
          }
          return 'navigated'
        }

        lastAction = { kind: 'failed', payload: key, at: Date.now() }
        const fb = feedbackForResult(lookup)
        if (fb) {
          showFeedback(
            opts?.fromOcr
              ? { ...fb, message: `${rawValue} — ${fb.message}` }
              : fb,
          )
        }
        return lookup.status === 'error' ? 'error' : 'miss'
      } catch {
        lastAction = { kind: 'failed', payload: key, at: Date.now() }
        showFeedback(NETWORK_FEEDBACK)
        return 'error'
      }
    },
    [navigate, queryClient, showFeedback],
  )

  const handleScan = useCallback(
    (result: ScanResult) => {
      void resolveAndAct(result.rawValue, result.format, result.at)
    },
    [resolveAndAct],
  )

  // --- Digit OCR (IMA-39): hands-free, alternating with barcode decode ------
  //
  // No button. While the camera is live, Tesseract passes run continuously in
  // a worker alongside the barcode decode loop; the first HIGH-confidence
  // number in frame — a 7-8 digit SKU, else an 11-14 digit UPC — is looked up
  // and, on found, navigates exactly like a barcode hit. SKU outranks UPC on
  // purpose: a UPC nearly always sits under a barcode the barcode loop reads
  // first, while a printed SKU (fact tag / monitor / pick list) never has one.
  const ocr = useDigitOcr()
  const videoElRef = useRef<HTMLVideoElement | null>(null)
  const handleVideoElement = useCallback((el: HTMLVideoElement | null) => {
    videoElRef.current = el
  }, [])
  /** Digits that already resolved to not-in-catalog this visit. A misread would
   *  otherwise re-fire a lookup on every pass while the same tag fills the
   *  frame; genuine misses are stable per payload, so blacklist them. */
  const missedDigitsRef = useRef<Set<string>>(new Set())

  // The loop reads through refs so it mounts exactly once and never restarts
  // when React re-creates the callbacks.
  const readRef = useRef(ocr.read)
  readRef.current = ocr.read
  const resolveRef = useRef(resolveAndAct)
  resolveRef.current = resolveAndAct

  useEffect(() => {
    let cancelled = false
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms))

    void (async () => {
      while (!cancelled) {
        const video = videoElRef.current
        const readable =
          video !== null && video.videoWidth > 0 && !document.hidden
        if (!readable) {
          await sleep(OCR_IDLE_GAP_MS)
          continue
        }

        const candidates = await readRef.current(video)
        if (cancelled) break

        const pick = pickAutoCandidate(candidates)
        if (pick && !missedDigitsRef.current.has(pick)) {
          const outcome = await resolveRef.current(pick, 'ocr', Date.now(), {
            fromOcr: true,
          })
          if (cancelled || outcome === 'navigated') break
          // 'collected' (Compare mode) keeps the loop alive — the associate
          // is mid-walk; re-collection is blocked by the suppression window.
          if (outcome === 'miss') missedDigitsRef.current.add(pick)
          if (outcome === 'error') await sleep(OCR_ERROR_BACKOFF_MS)
        }

        await sleep(OCR_PASS_GAP_MS)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 p-4">
      <header className="pt-2">
        <div className="flex items-center justify-between">
          <p className="aisle-label">Scanner</p>
          {/* Required source mark, top corner: scan lookups and history
              rows are Best Buy API data. */}
          <BestBuyAttribution className="-my-3" />
        </div>
        <h1 className="mt-1 text-title font-extrabold tracking-tight">
          Point at a barcode
        </h1>
        <p className="mt-1 text-body-sm text-text-muted">
          Barcodes, QR, or just a printed number — it also reads SKUs and UPCs
          off tags and screens automatically.
        </p>
      </header>

      {/* Scan mode (IMA-36): Detail / Chat / Compare segmented toggle. */}
      <ScanModeToggle mode={scanMode} />

      {/* Relative wrapper so the failure pill can float over the camera view.
          BarcodeScanner autoStarts and stops on unmount, so back-navigation
          from the detail page re-acquires the camera cleanly. The overlay
          mirrors the camera's aspect-[3/4] geometry so the pill sits at the
          bottom of the reticle, not below the whole component. */}
      <div className="relative">
        <BarcodeScanner
          onScan={handleScan}
          onVideoElement={handleVideoElement}
        />
        {feedback && (
          <div className="pointer-events-none absolute inset-x-0 top-0 flex aspect-[3/4] w-full items-end justify-center p-4">
            <ScanFeedbackPill feedback={feedback} />
          </div>
        )}
        <p className="mt-2 text-center text-caption text-text-faint">
          {ocr.status === 'loading'
            ? 'Warming up the number reader…'
            : 'Watching for barcodes and printed numbers'}
        </p>
      </div>

      {/* Compare mode's collected chips + Start compare (IMA-36). Rendered
          only in Compare mode so Detail/Chat scanning stays uncluttered even
          when the shared tray has leftovers from a detail-page walk. */}
      {scanMode === 'compare' && <CompareStrip />}

      {history.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="aisle-label">Recent scans ({history.length})</h2>
          <ul className="flex flex-col gap-2">
            {history.map((entry) => (
              <ScanHistoryRow
                key={`${entry.at}-${entry.rawValue}`}
                scan={entry}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
