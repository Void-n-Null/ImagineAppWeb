import { Link } from '@tanstack/react-router'
import { formatPerMillion, formatTokens } from '../format'
import type { ModelRecord } from '../types'
import { CapabilityBadges } from './capability-badges'
import { VendorLogo } from './vendor-logo'

/**
 * One model in the browsable list. The whole row is the tap target (≥64px);
 * hairline separators, no boxes. The selected model wears the price tag —
 * the app's signature (and only) yellow.
 */
export function ModelRow({
  model,
  selected,
}: {
  model: ModelRecord
  selected: boolean
}) {
  const { input, output } = model.cost

  return (
    <Link
      to="/models/$"
      params={{ _splat: model.id }}
      className="flex min-h-16 items-center gap-3 border-b border-line px-4 py-2.5 transition-colors duration-100 active:bg-surface"
    >
      <VendorLogo vendor={model.vendor} />

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-body font-semibold">{model.name}</span>
          {selected && <span className="price-tag shrink-0">Yours</span>}
        </span>
        <span className="mt-0.5 block truncate font-mono text-caption text-text-faint">
          {model.id}
        </span>
      </span>

      <span className="flex shrink-0 flex-col items-end gap-1">
        <span className="tabular text-body-sm text-text-muted">
          {input !== undefined && output !== undefined ? (
            <>
              {formatPerMillion(input)}
              <span className="text-text-faint"> / </span>
              {formatPerMillion(output)}
            </>
          ) : (
            <span className="text-text-faint">—</span>
          )}
        </span>
        <span className="flex items-center gap-1.5">
          <CapabilityBadges model={model} />
          {model.contextLength !== null && (
            <span className="tabular text-micro text-text-faint">
              {formatTokens(model.contextLength)}
            </span>
          )}
        </span>
      </span>
    </Link>
  )
}
