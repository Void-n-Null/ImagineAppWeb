/**
 * The chat page's implementation of the host scan capability (IMA-6).
 *
 * Port of v1's ScanRequestService, React-shaped: a tool (or the composer's
 * attach flow) asks for a scan, the page renders the scan sheet while a
 * session is active, and whoever asked awaits the outcome. The AGENT flow
 * carries v1's 20-second interaction timeout; the manual attach flow is
 * open-ended (the user is driving).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ScanOutcome } from '#/features/agent'

export const AGENT_SCAN_TIMEOUT_MS = 20_000

export interface ScanSession {
  mode: 'agent' | 'attach'
  /** What to scan, shown to the user ("the USB cable"). */
  promptText: string
  /** Epoch ms deadline (agent mode only). */
  deadline: number | null
}

interface ActiveSession extends ScanSession {
  resolve: (outcome: ScanOutcome) => void
  timer: ReturnType<typeof setTimeout> | null
}

export interface UseScanRequest {
  /** Non-null while the scan sheet should be visible. */
  session: ScanSession | null
  /** Host capability handed to the agent loop. */
  requestScan: (promptText: string) => Promise<ScanOutcome>
  /** Composer's "scan to attach" flow (no timeout). */
  requestAttachScan: () => Promise<ScanOutcome>
  /** Called by the scan sheet when it has an outcome. */
  complete: (outcome: ScanOutcome) => void
}

export function useScanRequest(): UseScanRequest {
  const [session, setSession] = useState<ScanSession | null>(null)
  const activeRef = useRef<ActiveSession | null>(null)

  const finish = useCallback((outcome: ScanOutcome) => {
    const active = activeRef.current
    if (!active) return
    if (active.timer !== null) clearTimeout(active.timer)
    activeRef.current = null
    setSession(null)
    active.resolve(outcome)
  }, [])

  const begin = useCallback(
    (mode: 'agent' | 'attach', promptText: string): Promise<ScanOutcome> => {
      // A newer request supersedes any dangling one.
      const previous = activeRef.current
      if (previous) {
        if (previous.timer !== null) clearTimeout(previous.timer)
        previous.resolve({ status: 'cancelled' })
      }
      return new Promise<ScanOutcome>((resolve) => {
        const deadline =
          mode === 'agent' ? Date.now() + AGENT_SCAN_TIMEOUT_MS : null
        const timer =
          mode === 'agent'
            ? setTimeout(
                () => finish({ status: 'timeout' }),
                AGENT_SCAN_TIMEOUT_MS,
              )
            : null
        activeRef.current = { mode, promptText, deadline, resolve, timer }
        setSession({ mode, promptText, deadline })
      })
    },
    [finish],
  )

  const requestScan = useCallback(
    (promptText: string) => begin('agent', promptText),
    [begin],
  )
  const requestAttachScan = useCallback(
    () => begin('attach', 'the product barcode'),
    [begin],
  )

  // Unmounting the chat page must not leave a tool call hanging forever.
  useEffect(
    () => () => {
      const active = activeRef.current
      if (active) {
        if (active.timer !== null) clearTimeout(active.timer)
        activeRef.current = null
        active.resolve({ status: 'cancelled' })
      }
    },
    [],
  )

  return { session, requestScan, requestAttachScan, complete: finish }
}
