import { Check, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

/**
 * The composer's recording state (IMA-25): swaps in for the input row while
 * the mic is live. Solid danger-tinted fill — not a tint on the idle look —
 * so "recording" reads at arm's length under store lighting (IMA-DOC-5).
 * Level bars are real input feedback (is it hearing me?), not decoration.
 */

const BAR_COUNT = 22

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function VoiceBar({
  startedAt,
  levelsRef,
  onCancel,
  onFinish,
}: {
  startedAt: number
  /** Rolling RMS history maintained by useVoiceInput; read per frame. */
  levelsRef: React.RefObject<number[]>
  onCancel: () => void
  onFinish: () => void
}) {
  const [elapsed, setElapsed] = useState('0:00')
  const [bars, setBars] = useState<number[]>([])
  const frameRef = useRef(0)

  useEffect(() => {
    const tick = () => {
      setElapsed(formatElapsed(Date.now() - startedAt))
      const levels = levelsRef.current ?? []
      setBars(levels.slice(-BAR_COUNT))
      frameRef.current = requestAnimationFrame(tick)
    }
    frameRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameRef.current)
  }, [startedAt, levelsRef])

  return (
    <output
      aria-label="Recording voice message"
      className="flex items-center gap-1.5 rounded-[1.15rem] bg-danger-subtle p-1.5"
    >
      <button
        type="button"
        onClick={onCancel}
        aria-label="Discard recording"
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-danger active:scale-95"
      >
        <X size={18} aria-hidden="true" />
      </button>

      <div
        aria-hidden="true"
        className="flex h-10 min-w-0 flex-1 items-center justify-center gap-[3px] overflow-hidden"
      >
        {/* Recording dot — unmissable even before you speak. */}
        <span className="mr-1.5 h-2 w-2 shrink-0 animate-pulse rounded-full bg-danger" />
        {Array.from({ length: BAR_COUNT }, (_, i) => {
          // Right-align history: newest sample drives the rightmost bar.
          const level = bars[bars.length - BAR_COUNT + i] ?? 0
          const height = 3 + Math.min(1, level * 6) * 19
          return (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed-size positional meter
              key={i}
              className="w-[3px] shrink-0 rounded-full bg-danger transition-[height] duration-75"
              style={{ height: `${height}px` }}
            />
          )
        })}
      </div>

      <span className="tabular shrink-0 px-1 text-body-sm font-bold text-danger">
        {elapsed}
      </span>

      <button
        type="button"
        onClick={onFinish}
        aria-label="Stop recording and transcribe"
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-danger text-danger-subtle transition-transform duration-100 active:scale-95"
      >
        <Check size={20} strokeWidth={3} aria-hidden="true" />
      </button>
    </output>
  )
}
