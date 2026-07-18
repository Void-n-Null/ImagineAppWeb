/**
 * Rich render-syntax parser (IMA-7) — the v1 card grammar, re-grounded for
 * the web UI:
 *
 *   [Product(8041012)]              → product card
 *   [Compare(8041012,8041013)]     → side-by-side strip, 2-5 SKUs
 *   [ShowSearch(query="65 inch")]  → tappable link into /search
 *   [FitVerdict(...)]               → vehicle-fit verdict card
 *
 * Pure string → segments; no React. The model writes tokens inline in its
 * markdown; the Markdown component renders text segments through
 * react-markdown and card segments as components. Anything that LOOKS like
 * a token but fails validation stays visible as plain text — silent drops
 * would make model mistakes undebuggable.
 *
 * v1 note: ShowSearch carried the full filter set (category, price band,
 * sort…). The v2 search page is deliberately a single-query surface
 * (IMA-DOC-5: employees retrieve), so only `query` survives the port;
 * unknown params are tolerated and ignored, not errors.
 */

const FIT_RECOMMENDATIONS = ['upright', 'tilted', 'flat', 'none'] as const

type FitRecommendation = (typeof FIT_RECOMMENDATIONS)[number]

export type RichSegment =
  | { kind: 'text'; text: string }
  | { kind: 'product'; sku: number }
  | { kind: 'compare'; skus: number[] }
  | { kind: 'search'; query: string }
  | FitVerdictSegment

export type FitVerdictSegment = {
  kind: 'fit-verdict'
  sku: number
  percentAny: number
  recommended: FitRecommendation
  vehicleLabel: string
  estimated: boolean
  boxH: number
  boxD: number
  openW: number
  openH: number
}

export const COMPARE_MIN_SKUS = 2
export const COMPARE_MAX_SKUS = 5

const TOKEN_RE = /\[(Product|Compare|ShowSearch|FitVerdict)\(([^)\]]*)\)\]/g

function parseSku(raw: string): number | null {
  const trimmed = raw.trim()
  if (!/^\d{4,12}$/.test(trimmed)) return null
  const sku = Number(trimmed)
  return Number.isSafeInteger(sku) && sku > 0 ? sku : null
}

function parsePercent(raw: string): number | null {
  const trimmed = raw.trim()
  if (!/^\d{1,3}$/.test(trimmed)) return null
  const percent = Number(trimmed)
  return percent >= 0 && percent <= 100 ? percent : null
}

function parsePositiveNumber(raw: string): number | null {
  const trimmed = raw.trim()
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) return null
  const value = Number(trimmed)
  return Number.isFinite(value) && value > 0 ? value : null
}

function parseVehicleLabel(raw: string): string | null {
  try {
    const vehicleLabel = decodeURIComponent(raw)
    return vehicleLabel.trim().length > 0 ? vehicleLabel : null
  } catch {
    return null
  }
}

function isFitRecommendation(value: string): value is FitRecommendation {
  return FIT_RECOMMENDATIONS.includes(value as FitRecommendation)
}

function parseToken(keyword: string, body: string): RichSegment | null {
  switch (keyword) {
    case 'Product': {
      const sku = parseSku(body)
      return sku !== null ? { kind: 'product', sku } : null
    }
    case 'Compare': {
      const parts = body.split(',')
      const skus: number[] = []
      for (const part of parts) {
        const sku = parseSku(part)
        if (sku === null) return null
        if (!skus.includes(sku)) skus.push(sku)
      }
      return skus.length >= COMPARE_MIN_SKUS && skus.length <= COMPARE_MAX_SKUS
        ? { kind: 'compare', skus }
        : null
    }
    case 'ShowSearch': {
      // Named param form: query="..." or query='...'
      const named = /query\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(body)
      const query = (named?.[1] ?? named?.[2])?.trim()
      if (query !== undefined) {
        return query.length > 0 ? { kind: 'search', query } : null
      }
      // Bare form [ShowSearch(gaming laptop)] — accept unless it smells
      // like unparseable named params.
      const bare = body.trim()
      return bare.length > 0 && !bare.includes('=')
        ? { kind: 'search', query: bare }
        : null
    }
    case 'FitVerdict': {
      const parts = body.split(',')
      if (parts.length !== 9) return null
      const [
        rawSku,
        rawPercentAny,
        rawRecommended,
        rawVehicleLabel,
        rawEstimated,
        rawBoxH,
        rawBoxD,
        rawOpenW,
        rawOpenH,
      ] = parts
      const sku = parseSku(rawSku)
      const percentAny = parsePercent(rawPercentAny)
      const recommended = rawRecommended.trim()
      const vehicleLabel = parseVehicleLabel(rawVehicleLabel)
      const estimated = rawEstimated.trim()
      const boxH = parsePositiveNumber(rawBoxH)
      const boxD = parsePositiveNumber(rawBoxD)
      const openW = parsePositiveNumber(rawOpenW)
      const openH = parsePositiveNumber(rawOpenH)
      if (
        sku === null ||
        percentAny === null ||
        !isFitRecommendation(recommended) ||
        vehicleLabel === null ||
        (estimated !== '0' && estimated !== '1') ||
        boxH === null ||
        boxD === null ||
        openW === null ||
        openH === null
      ) {
        return null
      }
      return {
        kind: 'fit-verdict',
        sku,
        percentAny,
        recommended,
        vehicleLabel,
        estimated: estimated === '1',
        boxH,
        boxD,
        openW,
        openH,
      }
    }
    default:
      return null
  }
}

export function parseRichSegments(text: string): RichSegment[] {
  const segments: RichSegment[] = []
  let buffer = ''
  let cursor = 0

  for (const match of text.matchAll(TOKEN_RE)) {
    const start = match.index ?? 0
    const parsed = parseToken(match[1], match[2])
    if (parsed === null) continue // stays in the running text
    buffer += text.slice(cursor, start)
    if (buffer.trim().length > 0) segments.push({ kind: 'text', text: buffer })
    buffer = ''
    segments.push(parsed)
    cursor = start + match[0].length
  }
  buffer += text.slice(cursor)
  if (buffer.trim().length > 0) segments.push({ kind: 'text', text: buffer })

  return segments.length > 0 ? segments : [{ kind: 'text', text: '' }]
}

/** Every SKU any card segment needs, deduped, in first-appearance order. */
export function collectCardSkus(segments: RichSegment[]): number[] {
  const skus: number[] = []
  for (const segment of segments) {
    if (segment.kind === 'product' && !skus.includes(segment.sku)) {
      skus.push(segment.sku)
    }
    if (segment.kind === 'compare') {
      for (const sku of segment.skus) {
        if (!skus.includes(sku)) skus.push(sku)
      }
    }
  }
  return skus
}

const KEYWORDS = ['Product', 'Compare', 'ShowSearch', 'FitVerdict']

/**
 * Streaming draft helper: if the text ends mid-token ("…[Product(80410"),
 * hold the partial back so the user never sees raw syntax flash before the
 * card pops in. Only the TRAILING edge needs this — completed tokens parse
 * normally.
 */
export function trimPartialRichToken(text: string): string {
  const idx = text.lastIndexOf('[')
  if (idx === -1) return text
  const tail = text.slice(idx)
  if (tail.includes(']')) return text // closed — nothing partial
  const match = /^\[([A-Za-z]*)(\()?/.exec(tail)
  if (!match) return text
  const word = match[1]
  const opened = match[2] !== undefined
  if (opened) {
    // "[Product(…" — only hold back if the keyword is exactly ours.
    return KEYWORDS.includes(word) ? text.slice(0, idx) : text
  }
  // "[Prod" — hold back while it could still become a keyword. Requires
  // the tail to be nothing but the partial word (links have more).
  const wholeTail = tail === `[${word}`
  return wholeTail && KEYWORDS.some((k) => k.startsWith(word))
    ? text.slice(0, idx)
    : text
}
