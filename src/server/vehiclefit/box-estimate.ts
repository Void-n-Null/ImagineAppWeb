export interface TvBoxDimensions {
  w: number
  h: number
  d: number
}

export interface TvBoxEstimate {
  box: TvBoxDimensions
  tolerance: TvBoxDimensions
}

export interface TvDimensions {
  width: string | null
  height: string | null
  depth: string | null
  details?: Record<string, string>
}

/**
 * Estimate a TV's retail shipping carton from panel dimensions.
 *
 * When catalog height is unavailable, a 16:9 panel height is derived from its
 * width with an added 1-inch bezel allowance. That estimate widens height
 * uncertainty to +/-3 inches; all other box dimensions use +/-2 inches.
 */
export function estimateTvBox(product: TvDimensions): TvBoxEstimate | null {
  const panelWidth = parseInches(product.width)
  if (panelWidth === null) return null

  const standFreeHeight = heightWithoutStand(product.details)
  const catalogHeight = parseInches(product.height)
  const derivedHeight = standFreeHeight ?? catalogHeight ?? panelWidth * (9 / 16) + 1
  const heightWasDerived = standFreeHeight === null && catalogHeight === null

  return {
    box: {
      w: panelWidth + 6,
      h: derivedHeight + 7,
      d: 9,
    },
    tolerance: {
      w: 2,
      h: heightWasDerived ? 3 : 2,
      d: 2,
    },
  }
}

function heightWithoutStand(details: Record<string, string> | undefined): number | null {
  if (details === undefined) return null
  for (const [name, value] of Object.entries(details)) {
    if (name.trim().toLocaleLowerCase('en-US') !== 'height without stand') {
      continue
    }
    const parsed = parseInches(value)
    if (parsed !== null) return parsed
  }
  return null
}

function parseInches(value: string | null): number | null {
  if (value === null) return null
  const match = /^\s*(\d+(?:\.\d+)?)\s*(?:inches?|in\.?|")\s*$/i.exec(value)
  if (!match) return null
  const inches = Number(match[1])
  return Number.isFinite(inches) && inches > 0 ? inches : null
}
