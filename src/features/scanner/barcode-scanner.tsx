import { Flashlight, FlashlightOff } from 'lucide-react'
import { cn } from '#/lib/utils'
import { type ScanResult, useBarcodeScanner } from './use-barcode-scanner'

export interface BarcodeScannerProps {
  onScan?: (result: ScanResult) => void
  className?: string
  /**
   * Hands the live `<video>` element to the parent (null on unmount) so it can
   * run its own frame consumers alongside barcode decoding — the /scan page's
   * continuous digit-OCR loop (IMA-39) grabs frames from it. The chat
   * ScanSheet doesn't pass this and stays a pure barcode scanner.
   */
  onVideoElement?: (el: HTMLVideoElement | null) => void
}

export function BarcodeScanner({
  onScan,
  className,
  onVideoElement,
}: BarcodeScannerProps) {
  const {
    videoRef,
    status,
    error,
    lastResult,
    torchSupported,
    torchOn,
    start,
    toggleTorch,
  } = useBarcodeScanner({ onScan, autoStart: true })

  const live =
    status === 'scanning' || status === 'starting' || status === 'paused'

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-2xl bg-black">
        <video
          ref={(el) => {
            videoRef.current = el
            onVideoElement?.(el)
          }}
          className="h-full w-full object-cover"
          autoPlay
          playsInline
          muted
        />

        {/* Scan-region reticle */}
        {live && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="relative h-2/5 w-4/5">
              <Corner className="left-0 top-0 border-l-4 border-t-4" />
              <Corner className="right-0 top-0 border-r-4 border-t-4" />
              <Corner className="bottom-0 left-0 border-b-4 border-l-4" />
              <Corner className="bottom-0 right-0 border-b-4 border-r-4" />
              {status === 'scanning' && (
                <div className="absolute inset-x-0 top-1/2 h-0.5 animate-pulse bg-emerald-400/80" />
              )}
            </div>
          </div>
        )}

        {torchSupported && live && (
          <button
            type="button"
            onClick={toggleTorch}
            aria-label={torchOn ? 'Turn off flashlight' : 'Turn on flashlight'}
            className={cn(
              'absolute right-4 top-4 grid h-12 w-12 place-items-center rounded-full backdrop-blur transition-colors',
              torchOn
                ? 'bg-amber-400 text-black'
                : 'bg-black/50 text-white hover:bg-black/70',
            )}
          >
            {torchOn ? (
              <Flashlight className="h-6 w-6" />
            ) : (
              <FlashlightOff className="h-6 w-6" />
            )}
          </button>
        )}

        {status === 'paused' && (
          <div className="absolute inset-0 grid place-items-center bg-black/60 text-sm text-white">
            Paused
          </div>
        )}
      </div>

      {error && (
        <p className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </p>
      )}

      {lastResult && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3">
          <div className="text-xs font-medium uppercase tracking-wide text-emerald-500">
            {formatLabel(lastResult.format)}
          </div>
          <div className="mt-1 break-all font-mono text-lg text-foreground">
            {lastResult.rawValue}
          </div>
        </div>
      )}

      {status === 'error' && (
        <button
          type="button"
          onClick={() => void start()}
          className="h-14 rounded-full bg-primary text-base font-semibold text-primary-foreground"
        >
          Try again
        </button>
      )}
    </div>
  )
}

function Corner({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'absolute h-7 w-7 rounded-sm border-emerald-400',
        className,
      )}
    />
  )
}

function formatLabel(format: string): string {
  return format.replace(/_/g, ' ').toUpperCase()
}
