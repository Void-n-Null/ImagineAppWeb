import type { BestBuyProduct } from '#/server/bestbuy/types'
import { getProductDetail } from '#/server/functions/get-product-detail'
import { estimateTvBox } from '#/server/vehiclefit/box-estimate'
import { computeFit } from '#/server/vehiclefit/geometry'
import type { AgentTool } from '../tool'

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined
}

function cargoSpecsSource(value: unknown): string | undefined {
  const source = nonEmptyString(value)
  if (!source || source === 'estimated') return source
  try {
    new URL(source)
    return source
  } catch {
    return undefined
  }
}

/** compute_tv_fit: probabilistic TV-box fit using sourced cargo measurements. */
export const computeTvFitTool: AgentTool = {
  name: 'compute_tv_fit',
  description: `Estimate whether a TV's retail box can fit through a vehicle opening and across its cargo floor.

Before calling this tool, use web_search to find cargo length with seats down, opening width, and opening height. Make MULTIPLE searches when needed: try different vehicle-name phrasings and manufacturer specification pages. Pass the source URL in specsSource. Call this only after you have real numbers from a source. If a handful of searches cannot find reliable cargo dimensions, do NOT guess wildly: tell the user you could not find reliable dimensions and suggest measuring instead. Use estimated:true only for partial data with a reasonable, clearly flagged interpolation.`,
  parameters: {
    type: 'object',
    properties: {
      sku: { type: 'integer', description: 'Best Buy SKU for the TV.' },
      vehicleLabel: {
        type: 'string',
        description: 'Vehicle being measured, e.g. "2019 Honda CR-V".',
      },
      cargoLengthIn: {
        type: 'number',
        description: 'Seats-down cargo length in inches from a cited source.',
      },
      openingWidthIn: {
        type: 'number',
        description: 'Cargo opening width in inches from a cited source.',
      },
      openingHeightIn: {
        type: 'number',
        description: 'Cargo opening height in inches from a cited source.',
      },
      specsSource: {
        type: 'string',
        description: "Source URL for cargo measurements, or 'estimated' when clearly flagged.",
      },
      estimated: {
        type: 'boolean',
        description: 'Set true if any supplied cargo number is a reasonable estimate.',
      },
    },
    required: [
      'sku',
      'vehicleLabel',
      'cargoLengthIn',
      'openingWidthIn',
      'openingHeightIn',
      'specsSource',
    ],
  },
  statusLabel(args) {
    const label = nonEmptyString(args.vehicleLabel)
    return label ? `Checking fit for ${label}` : 'Checking TV fit'
  },
  async execute(args) {
    const sku =
      typeof args.sku === 'number' && Number.isSafeInteger(args.sku) && args.sku > 0
        ? args.sku
        : undefined
    const vehicleLabel = nonEmptyString(args.vehicleLabel)
    const cargoLengthIn = positiveNumber(args.cargoLengthIn)
    const openingWidthIn = positiveNumber(args.openingWidthIn)
    const openingHeightIn = positiveNumber(args.openingHeightIn)
    const specsSource = cargoSpecsSource(args.specsSource)
    if (
      sku === undefined ||
      !vehicleLabel ||
      cargoLengthIn === undefined ||
      openingWidthIn === undefined ||
      openingHeightIn === undefined ||
      !specsSource
    ) {
      return 'Error: SKU, vehicle label, positive cargo dimensions, and a source URL or "estimated" specsSource are required.'
    }

    let productResult: Awaited<ReturnType<typeof getProductDetail>>
    try {
      productResult = await getProductDetail({ data: { sku } })
    } catch {
      return `Could not look up SKU ${sku} for the fit check. Try again in a moment.`
    }
    if (productResult.status === 'not_found') {
      return `No product found for SKU ${sku}. Verify the SKU before running a fit check.`
    }
    if (productResult.status === 'error') {
      return `Could not look up SKU ${sku}: ${productResult.message}`
    }

    const estimate = estimateTvBox(productDimensions(productResult.product))
    if (estimate === null) {
      return "The fit check isn't available for this product because its panel dimensions could not be read from the catalog. Suggest measuring the boxed product instead."
    }

    const result = computeFit({
      ...estimate,
      cargo: { cargoLengthIn, openingWidthIn, openingHeightIn },
    })
    const pAnyPercent = Math.round(result.pAny * 100)
    const estimated = args.estimated === true
    const verdict =
      result.pAny < 0.15
        ? 'very unlikely to fit'
        : result.pAny > 0.85
          ? 'should fit'
          : 'tight, measure first'
    const lines = [
      '# TV fit check',
      `- Vehicle: ${vehicleLabel}`,
      `- Cargo dimensions: ${formatInches(cargoLengthIn)} length, ${formatInches(openingWidthIn)} opening width, ${formatInches(openingHeightIn)} opening height`,
      `- Cargo source: ${specsSource}${estimated ? ' (partly estimated)' : ''}`,
      `- Estimated box: ${formatInches(estimate.box.w)} W × ${formatInches(estimate.box.h)} H × ${formatInches(estimate.box.d)} D (±${formatInches(estimate.tolerance.w)}/±${formatInches(estimate.tolerance.h)}/±${formatInches(estimate.tolerance.d)})`,
      `- Fit probabilities: ${percent(result.pUpright)} upright, ${percent(result.pTilted)} tilted, ${percent(result.pFlat)} flat; ${percent(result.pAny)} any orientation`,
      result.worstCaseFit
        ? '- Worst-case margin check passed: box +2 in still fits cargo -2 in.'
        : '- Worst-case margin check failed (box +2 in vs cargo -2 in), so confidence is capped at 80%. Tell the user the fit depends on exact measurements.',
      `- Recommended orientation: ${result.recommended}`,
      `- Verdict: ${verdict}.`,
      '- Flat transport is not recommended for panels.',
      '',
      `[FitVerdict(${sku},${pAnyPercent},${result.recommended},${tokenVehicleLabel(vehicleLabel)},${estimated ? 1 : 0},${tokenDimension(estimate.box.h)},${tokenDimension(estimate.box.d)},${tokenDimension(openingWidthIn)},${tokenDimension(openingHeightIn)})]`,
    ]
    return lines.join('\n')
  },
}

function productDimensions(product: BestBuyProduct) {
  const details: Record<string, string> = {}
  for (const detail of product.details) details[detail.name] = detail.value
  return {
    width: product.width,
    height: product.height,
    depth: product.depth,
    details,
  }
}

function formatInches(value: number): string {
  return `${value.toFixed(1).replace(/\.0$/, '')} in`
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function tokenDimension(value: number): string {
  return value.toFixed(1)
}

function tokenVehicleLabel(value: string): string {
  return encodeURIComponent(value).replaceAll('(', '%28').replaceAll(')', '%29')
}
