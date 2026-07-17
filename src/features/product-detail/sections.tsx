import { useState } from 'react'
import type { BestBuyProduct } from '#/server/bestbuy/types'

// The spec table lives in spec-section.tsx (IMA-29): full manufacturer
// sheet + fuzzy alias-aware search + unit toggle.

/** Feature bullets, collapsed past six — floor answers live in the top few. */
export function FeatureList({ features }: { features: string[] }) {
  const [expanded, setExpanded] = useState(false)
  if (features.length === 0) return null
  const visible = expanded ? features : features.slice(0, 6)

  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="aisle-label">Key features</h2>
      <ul className="flex flex-col gap-2">
        {visible.map((feature) => (
          <li
            key={feature}
            className="flex gap-2.5 text-body-sm leading-relaxed text-text-muted"
          >
            <span
              aria-hidden="true"
              className="mt-[0.5em] h-1.5 w-1.5 shrink-0 rounded-full bg-action"
            />
            {feature}
          </li>
        ))}
      </ul>
      {features.length > 6 && (
        <button
          type="button"
          onClick={() => setExpanded((on) => !on)}
          className="self-start text-body-sm font-bold text-action"
        >
          {expanded ? 'Show fewer' : `Show all ${features.length}`}
        </button>
      )}
    </section>
  )
}

/** Short + long description with a collapse on the long one. */
export function DescriptionSection({ product }: { product: BestBuyProduct }) {
  const [expanded, setExpanded] = useState(false)
  const short = product.shortDescription
  const long = product.longDescription
  if (short === null && long === null) return null
  // Best Buy frequently duplicates short into long — don't render twice.
  const longIsDistinct = long !== null && long !== short

  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="aisle-label">About</h2>
      {short !== null && (
        <p className="text-body-sm leading-relaxed text-text-muted">{short}</p>
      )}
      {longIsDistinct &&
        (expanded ? (
          <p className="text-body-sm leading-relaxed text-text-muted">{long}</p>
        ) : null)}
      {longIsDistinct && (
        <button
          type="button"
          onClick={() => setExpanded((on) => !on)}
          className="self-start text-body-sm font-bold text-action"
        >
          {expanded ? 'Show less' : 'Full description'}
        </button>
      )}
    </section>
  )
}

/** What's in the box. */
export function IncludedItems({ items }: { items: string[] }) {
  if (items.length === 0) return null
  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="aisle-label">In the box</h2>
      <ul className="flex flex-col gap-1.5">
        {items.map((item) => (
          <li
            key={item}
            className="text-body-sm leading-relaxed text-text-muted"
          >
            {item}
          </li>
        ))}
      </ul>
    </section>
  )
}
