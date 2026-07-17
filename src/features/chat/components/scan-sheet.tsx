import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ScanOutcome } from '#/features/agent'
import { BarcodeScanner } from '#/features/scanner/barcode-scanner'
import type { ScanResult } from '#/features/scanner/use-barcode-scanner'
import { lookupScannedProduct } from '#/server/functions/lookup-scanned-product'
import type { ScanSession } from '../use-scan-request'

/**
 * Full-screen scanner overlay serving both scan flows (IMA-6):
 *  - agent-requested (request_scan tool): 20s countdown, outcome resolves
 *    into the tool result
 *  - manual attach (composer): open-ended; not-found keeps scanning so the
 *    user can try another barcode
 */
export function ScanSheet({
  session,
  onComplete,
}: {
  session: ScanSession
  onComplete: (outcome: ScanOutcome) => void
}) {
  const [lookingUp, setLookingUp] = useState(false)
  const [miss, setMiss] = useState<string | null>(null)

  const handleScan = (result: ScanResult) => {
    if (lookingUp) return
    setLookingUp(true)
    setMiss(null)
    void lookupScannedProduct({
      data: { rawValue: result.rawValue, format: result.format },
    })
      .then((lookup) => {
        switch (lookup.status) {
          case 'found':
            onComplete({ status: 'scanned', product: lookup.product })
            break
          case 'not_found':
            if (session.mode === 'agent') {
              onComplete({ status: 'not-found', code: result.rawValue })
            } else {
              setMiss('Not in the Best Buy catalog — try another barcode.')
            }
            break
          case 'unrecognized':
            setMiss('Not a product code — aim at the UPC or shelf tag.')
            break
          case 'error':
            setMiss(lookup.message)
            break
        }
      })
      .catch(() => {
        setMiss('Lookup failed — check connection.')
      })
      .finally(() => {
        setLookingUp(false)
      })
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Barcode scanner"
      className="fixed inset-0 z-50 overflow-y-auto bg-bg"
    >
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 p-5 pt-[max(1.25rem,calc(env(safe-area-inset-top)+0.5rem))] pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <header className="flex items-start justify-between gap-3 pt-1">
          <div className="min-w-0">
            <p className="aisle-label">
              {session.mode === 'agent' ? 'Assistant asks' : 'Attach product'}
            </p>
            <h2 className="mt-1 text-title font-extrabold leading-tight tracking-tight">
              Scan {session.promptText}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => onComplete({ status: 'cancelled' })}
            aria-label="Cancel scan"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-raised text-text-muted transition-transform duration-100 active:scale-95"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        {session.deadline !== null && <Countdown deadline={session.deadline} />}

        <BarcodeScanner onScan={handleScan} />

        <div aria-live="polite" className="min-h-6">
          {lookingUp ? (
            <p className="status-shimmer text-body-sm font-semibold">
              Looking up…
            </p>
          ) : miss ? (
            <p className="text-body-sm font-semibold text-danger">{miss}</p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/** Time left before the agent's 20s scan window closes. */
function Countdown({ deadline }: { deadline: number }) {
  const [remainingMs, setRemainingMs] = useState(deadline - Date.now())

  useEffect(() => {
    const timer = setInterval(() => {
      setRemainingMs(deadline - Date.now())
    }, 250)
    return () => clearInterval(timer)
  }, [deadline])

  const seconds = Math.max(0, Math.ceil(remainingMs / 1000))
  const fraction = Math.max(0, Math.min(1, remainingMs / 20_000))

  return (
    <div className="flex items-center gap-3">
      <div
        aria-hidden="true"
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-raised"
      >
        <div
          className="h-full rounded-full bg-action transition-[width] duration-300 ease-linear"
          style={{ width: `${fraction * 100}%` }}
        />
      </div>
      <span className="tabular shrink-0 text-caption font-bold text-text-muted">
        {seconds}s
      </span>
    </div>
  )
}
