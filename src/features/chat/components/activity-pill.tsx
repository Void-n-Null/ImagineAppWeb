/**
 * The default face of the agent at work (IMA-6): one quiet line naming the
 * current step ("Searching “65 inch tv”…"). The full tool ledger stays
 * hidden unless the user flips on tool activity (debug view).
 */
export function ActivityPill({ label }: { label: string }) {
  return (
    <output
      aria-live="polite"
      className="flex min-h-8 items-center gap-2.5 self-start"
    >
      <span
        aria-hidden="true"
        className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-action"
      />
      <span className="status-shimmer text-body-sm font-semibold">
        {label}…
      </span>
    </output>
  )
}
