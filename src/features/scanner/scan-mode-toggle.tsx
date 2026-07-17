import {
  SCAN_MODE_CAPTIONS,
  SCAN_MODE_LABELS,
  SCAN_MODES,
  type ScanMode,
  setScanMode,
} from './scan-mode'

/**
 * The scan-mode segmented control (IMA-36): an inset track with a raised
 * capsule that springs between segments, iOS-style. The active segment is
 * never marked by the capsule alone (IMA-DOC-5): weight + text color +
 * aria-pressed all flip with it. The caption below swaps with the mode and
 * is the control's entire onboarding.
 */
export function ScanModeToggle({ mode }: { mode: ScanMode }) {
  const index = SCAN_MODES.indexOf(mode)

  return (
    <div className="flex flex-col gap-1.5">
      <fieldset className="relative m-0 grid grid-cols-3 rounded-full border-0 bg-surface p-1 shadow-[inset_0_1px_3px_rgb(0_0_0/0.4)]">
        <legend className="sr-only">After a scan</legend>
        {/* The sliding capsule — same spring as the dock pill. Width is one
            cell of the padded track, so translateX(n × 100%) lands exactly
            on segment n. Global reduced-motion clamps the transition. */}
        <span
          aria-hidden="true"
          className="card-glint absolute inset-y-1 left-1 w-[calc((100%-0.5rem)/3)] rounded-full bg-raised transition-transform duration-300 [transition-timing-function:var(--ease-spring)]"
          style={{ transform: `translateX(${index * 100}%)` }}
        />
        {SCAN_MODES.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            onClick={() => {
              if (value === mode) return
              navigator.vibrate?.(10)
              setScanMode(value)
            }}
            className={`relative z-10 flex h-9 items-center justify-center rounded-full text-body-sm transition-colors duration-150 ${
              mode === value
                ? 'font-bold text-text'
                : 'font-medium text-text-muted'
            }`}
          >
            {SCAN_MODE_LABELS[value]}
          </button>
        ))}
      </fieldset>
      {/* Keyed so the caption re-runs its entrance on every mode change. */}
      <p
        key={mode}
        aria-live="polite"
        className="slide-down text-center text-caption text-text-faint"
      >
        {SCAN_MODE_CAPTIONS[mode]}
      </p>
    </div>
  )
}
