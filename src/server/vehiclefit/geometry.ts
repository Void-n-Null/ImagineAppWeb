import type { TvBoxDimensions } from './box-estimate'

export const FIT_SAMPLE_COUNT = 4000

export interface CargoDimensions {
  cargoLengthIn: number
  openingWidthIn: number
  openingHeightIn: number
  /** Fractional sample tolerances, e.g. 0.08 means +/-8%. */
  tolerance?: {
    cargoLength?: number
    openingWidth?: number
    openingHeight?: number
  }
}

export interface ComputeFitInput {
  box: TvBoxDimensions
  tolerance: TvBoxDimensions
  cargo: CargoDimensions
  /** Optional deterministic seed for repeatable evaluations and tests. */
  seed?: number
}

export interface FitResult {
  pUpright: number
  pTilted: number
  pFlat: number
  pAny: number
  recommended: 'upright' | 'tilted' | 'flat' | 'none'
  samples: number
}

/**
 * Estimate TV-box fit with independent, uniformly distributed measurement
 * uncertainty. This is intentionally pure and repeatable under a fixed seed.
 */
export function computeFit(input: ComputeFitInput): FitResult {
  const random = mulberry32(input.seed ?? 0x1fa50)
  const cargoTolerance = {
    cargoLength: normalizedTolerance(input.cargo.tolerance?.cargoLength, 0.08),
    openingWidth: normalizedTolerance(input.cargo.tolerance?.openingWidth, 0.05),
    openingHeight: normalizedTolerance(input.cargo.tolerance?.openingHeight, 0.05),
  }

  let uprightCount = 0
  let tiltedCount = 0
  let flatCount = 0
  let anyCount = 0

  for (let sample = 0; sample < FIT_SAMPLE_COUNT; sample += 1) {
    const box = {
      w: sampleAbsolute(input.box.w, input.tolerance.w, random),
      h: sampleAbsolute(input.box.h, input.tolerance.h, random),
      d: sampleAbsolute(input.box.d, input.tolerance.d, random),
    }
    const cargoLength = sampleFractional(
      input.cargo.cargoLengthIn,
      cargoTolerance.cargoLength,
      random,
    )
    const openingWidth = sampleFractional(
      input.cargo.openingWidthIn,
      cargoTolerance.openingWidth,
      random,
    )
    const openingHeight = sampleFractional(
      input.cargo.openingHeightIn,
      cargoTolerance.openingHeight,
      random,
    )

    // A boxed TV can load diagonally across the cargo floor. Opening width is
    // used as a conservative floor-width proxy; 5% discounts unusable corners.
    const availableLength =
      0.95 * Math.sqrt(cargoLength * cargoLength + openingWidth * openingWidth)
    const lengthFits = availableLength >= box.w

    const upright =
      lengthFits && openingHeight >= box.h && openingWidth >= box.d
    const tilted =
      lengthFits &&
      rectangleFitsWithRotation(box.h, box.d, openingWidth, openingHeight)
    const flat =
      lengthFits && openingHeight >= box.d && openingWidth >= box.h

    if (upright) uprightCount += 1
    if (tilted) tiltedCount += 1
    if (flat) flatCount += 1
    if (upright || tilted || flat) anyCount += 1
  }

  const pUpright = uprightCount / FIT_SAMPLE_COUNT
  const pTilted = tiltedCount / FIT_SAMPLE_COUNT
  const pFlat = flatCount / FIT_SAMPLE_COUNT
  const pAny = anyCount / FIT_SAMPLE_COUNT
  return {
    pUpright,
    pTilted,
    pFlat,
    pAny,
    recommended: recommendedOrientation(pUpright, pTilted, pFlat, pAny),
    samples: FIT_SAMPLE_COUNT,
  }
}

function normalizedTolerance(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : fallback
}

function sampleAbsolute(value: number, tolerance: number, random: () => number): number {
  return value + (random() * 2 - 1) * Math.max(0, tolerance)
}

function sampleFractional(value: number, tolerance: number, random: () => number): number {
  return value * (1 + (random() * 2 - 1) * tolerance)
}

/** Test whether a rectangle can pass through an aperture in any rotation. */
function rectangleFitsWithRotation(
  rectangleWidth: number,
  rectangleHeight: number,
  apertureWidth: number,
  apertureHeight: number,
): boolean {
  if (
    (rectangleWidth <= apertureWidth && rectangleHeight <= apertureHeight) ||
    (rectangleWidth <= apertureHeight && rectangleHeight <= apertureWidth)
  ) {
    return true
  }

  const p = Math.max(rectangleWidth, rectangleHeight)
  const q = Math.min(rectangleWidth, rectangleHeight)
  return (
    rotatedRectangleFits(p, q, apertureWidth, apertureHeight) ||
    rotatedRectangleFits(p, q, apertureHeight, apertureWidth)
  )
}

/** Closed-form rotated rectangle containment predicate. */
function rotatedRectangleFits(p: number, q: number, a: number, b: number): boolean {
  if (p <= a || q > b) return false
  const squared = p * p + q * q - a * a
  if (squared < 0) return false
  const requiredB =
    (2 * p * q * a + (p * p - q * q) * Math.sqrt(squared)) /
    (p * p + q * q)
  return b >= requiredB
}

function recommendedOrientation(
  pUpright: number,
  pTilted: number,
  pFlat: number,
  pAny: number,
): FitResult['recommended'] {
  if (pAny === 0) return 'none'
  const highest = Math.max(pUpright, pTilted, pFlat)
  if (pUpright > 0 && pUpright >= highest - 0.05) return 'upright'
  if (pTilted > 0 && pTilted >= highest - 0.05) return 'tilted'
  if (pFlat > 0) return 'flat'
  return 'none'
}

function mulberry32(seed: number): () => number {
  let state = Math.trunc(seed) >>> 0
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}
