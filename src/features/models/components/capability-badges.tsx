import { Brain, Eye, Wrench } from 'lucide-react'
import { hasVision } from '../filter'
import type { ModelRecord } from '../types'

/**
 * Compact capability markers for dense list rows: icon + screen-reader text.
 * The detail page spells capabilities out in full words — these are just the
 * scannable shorthand. Free-ness is the price column's job, not ours.
 */
export function CapabilityBadges({ model }: { model: ModelRecord }) {
  const badges: Array<{ label: string; Icon: typeof Brain }> = []
  if (model.reasoning) badges.push({ label: 'Reasoning', Icon: Brain })
  if (model.toolCall) badges.push({ label: 'Tool calls', Icon: Wrench })
  if (hasVision(model)) badges.push({ label: 'Vision', Icon: Eye })

  if (badges.length === 0) return null

  return (
    <span className="flex items-center gap-1.5">
      {badges.map(({ label, Icon }) => (
        <span key={label} className="text-text-faint" title={label}>
          <Icon size={13} aria-hidden="true" />
          <span className="sr-only">{label}</span>
        </span>
      ))}
    </span>
  )
}
