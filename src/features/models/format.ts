// Display formatters for model metadata. Tiered precision (proseus lesson):
// per-1M prices span $0.02 → $50, so fixed decimals either lie or shout.

/** "$3", "$2.50", "$0.075" — USD per 1M tokens. */
export function formatPerMillion(usd: number): string {
  if (usd === 0) return '$0'
  if (usd >= 100) return `$${Math.round(usd)}`
  if (usd >= 1) return `$${trimZeros(usd.toFixed(2))}`
  return `$${trimZeros(usd.toFixed(3))}`
}

function trimZeros(fixed: string): string {
  return fixed.replace(/\.?0+$/, '')
}

/** "1M", "262K", "8K" — token counts. */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000)
    return `${trimZeros((tokens / 1_000_000).toFixed(1))}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`
  return String(tokens)
}

/**
 * Strip catalog suffixes like "(latest)" / "(free)" for tight card layouts —
 * the price column and tag chips already carry that information.
 */
export function cleanModelName(name: string): string {
  return name.replace(/\s*\((latest|free|preview)\)\s*$/i, '')
}

/** "Jun 2026" from an ISO date, or null when unparsable. */
export function formatMonth(isoDate: string): string | null {
  const date = new Date(`${isoDate}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}
