import { Link } from '@tanstack/react-router'
import { cleanModelName } from '../format'
import type { RecommendedPick } from '../recommended'
import type { ModelRecord } from '../types'
import { vendorName } from '../vendor'
import { VendorLogo } from './vendor-logo'

/**
 * One tier of the three-model lineup (IMA-43). Editorial anatomy, top to
 * bottom: tagline eyebrow + tier numeral, identity row, the reason it earned
 * its slot, and a measured-stats footer — benchmark score, answer speed, and
 * how many questions a $0.50 grant buys. Real numbers from the floor bench,
 * not vibes; the per-token pricing lives on the model detail page.
 *
 * The tagline is the editorial voice — blue. Yellow appears only when the
 * pick is the user's current model.
 */
export function PickCard({
  model,
  pick,
  selected,
  index,
}: {
  model: ModelRecord
  pick: RecommendedPick
  selected: boolean
  /** 1-based tier number, shown as a faint editorial numeral. */
  index?: number
}) {
  const { stats } = pick

  return (
    <Link
      to="/models/$"
      params={{ _splat: model.id }}
      className="card-glint flex flex-col gap-3 rounded-xl bg-surface p-4 transition-transform duration-100 active:scale-[0.98]"
    >
      <span className="flex items-center justify-between gap-2">
        <span className="rounded-full bg-action-subtle px-2.5 py-1 text-micro font-bold uppercase tracking-wider text-action">
          {pick.tagline}
        </span>
        {selected ? (
          <span className="price-tag">Yours</span>
        ) : index !== undefined ? (
          <span
            aria-hidden="true"
            className="font-mono text-caption font-bold text-text-faint/60"
          >
            {String(index).padStart(2, '0')}
          </span>
        ) : null}
      </span>

      <span className="flex items-center gap-2.5">
        <VendorLogo vendor={model.vendor} size={36} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body-lg font-bold leading-tight">
            {cleanModelName(model.name)}
          </span>
          <span className="mt-0.5 block text-micro font-medium tracking-wide text-text-faint">
            {vendorName(model.vendor)}
          </span>
        </span>
      </span>

      <span className="text-body-sm leading-relaxed text-text-muted">
        {pick.blurb}
      </span>

      <span className="tabular mt-auto grid grid-cols-3 gap-2 border-t border-line pt-2.5">
        <Stat value={`${stats.benchPercent}%`} label="floor bench" />
        <Stat value={`${stats.medianSeconds}s`} label="per answer" />
        <Stat value={`~${stats.questionsPerGrant}`} label="questions / $0.50" />
      </span>
    </Link>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <span className="flex flex-col gap-0.5">
      <span className="text-body-sm font-bold text-text">{value}</span>
      <span className="text-micro font-medium tracking-wide text-text-faint">
        {label}
      </span>
    </span>
  )
}
