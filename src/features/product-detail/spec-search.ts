import type { SpecRow } from './spec-model'

/**
 * Fuzzy, alias-aware spec search (IMA-29) — the direct answer to DOC-13's
 * Sidekick complaint: "no search, you scroll forever hunting for the one
 * attribute the customer asked about, while they watch."
 *
 * Design constraints, in order:
 * 1. NEVER miss the row the employee is after (recall first — an employee
 *    who searches "size" and sees nothing looks foolish; that is the one
 *    unforgivable failure). Aliases + typo tolerance serve this.
 * 2. Rank the obvious hit first (exact/prefix beats fuzzy).
 * 3. Zero dependencies, deterministic, fast enough per keystroke for a few
 *    hundred rows.
 *
 * Matching per query token (tokens are AND'd):
 *   substring of label      → strongest (word-start beats mid-word)
 *   substring of value      → strong (the user searches values too:
 *                             "alexa" should find Voice Assistant: Alexa)
 *   alias expansion         → medium ("size" → width/height/depth/…)
 *   typo tolerance          → weakest (Damerau-Levenshtein ≤ 1, or ≤ 2 for
 *                             tokens of 7+, against label/value words)
 */

export interface SpecMatch {
  row: SpecRow
  score: number
  /** [start, end) highlight ranges into row.label / row.value. */
  labelRanges: [number, number][]
  valueRanges: [number, number][]
}

/**
 * Floor-vocabulary alias groups. A query token matching any term in a group
 * (exact or prefix, both directions) also matches rows containing any other
 * term of that group. Grouped by what customers actually ask, not by
 * spec-sheet taxonomy.
 */
const ALIAS_GROUPS: string[][] = [
  // The mandated example: size = the dimension family.
  [
    'size',
    'dimensions',
    'width',
    'height',
    'depth',
    'length',
    'tall',
    'wide',
    'deep',
  ],
  ['weight', 'pounds', 'lbs', 'heavy'],
  ['wifi', 'wi fi', 'wireless', 'network'],
  ['bluetooth', 'bt'],
  ['refresh', 'hz', 'hertz', 'refresh rate'],
  ['resolution', '4k', '8k', '1080p', '720p', 'uhd', 'hd'],
  [
    'port',
    'ports',
    'input',
    'inputs',
    'output',
    'outputs',
    'hdmi',
    'usb',
    'jack',
    'connector',
    'connection',
  ],
  ['power', 'watt', 'watts', 'wattage', 'voltage', 'volts'],
  ['battery', 'battery life', 'runtime', 'mah', 'charge'],
  [
    'storage',
    'capacity',
    'gb',
    'tb',
    'terabyte',
    'gigabyte',
    'hard drive',
    'ssd',
  ],
  ['memory', 'ram'],
  ['screen', 'display', 'panel', 'diagonal'],
  ['warranty', 'guarantee', 'coverage'],
  ['color', 'colour', 'finish'],
  ['processor', 'cpu', 'chip', 'chipset'],
  ['graphics', 'gpu', 'video card'],
  [
    'smart',
    'alexa',
    'google assistant',
    'homekit',
    'voice assistant',
    'assistant',
  ],
  ['audio', 'sound', 'speaker', 'speakers', 'channel', 'channels', 'subwoofer'],
  ['energy', 'energy star', 'efficiency', 'consumption'],
  ['brand', 'manufacturer', 'make'],
  ['model', 'model number', 'part number'],
  ['camera', 'megapixel', 'mp', 'lens'],
  ['waterproof', 'water resistant', 'ip rating', 'weatherproof'],
]

function normalizeToken(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Terms a query token expands to via the alias table (excluding itself). */
function aliasTermsFor(token: string): string[] {
  const terms = new Set<string>()
  for (const group of ALIAS_GROUPS) {
    const hit = group.some(
      (term) =>
        term === token ||
        (token.length >= 3 && term.startsWith(token)) ||
        (term.length >= 3 && token.startsWith(term)),
    )
    if (hit) for (const term of group) terms.add(term)
  }
  terms.delete(token)
  return [...terms]
}

/** Damerau-Levenshtein distance, capped at 2 (early-out on impossible). */
export function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3
  const rows = a.length + 1
  const cols = b.length + 1
  const d: number[] = new Array(rows * cols)
  for (let i = 0; i < rows; i++) d[i * cols] = i
  for (let j = 0; j < cols; j++) d[j] = j
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let best = Math.min(
        d[(i - 1) * cols + j] + 1,
        d[i * cols + j - 1] + 1,
        d[(i - 1) * cols + j - 1] + cost,
      )
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, d[(i - 2) * cols + j - 2] + cost)
      }
      d[i * cols + j] = best
    }
  }
  return d[rows * cols - 1]
}

/** Typo budget by token length: short tokens must be exact. */
function typoBudget(token: string): number {
  if (token.length >= 7) return 2
  if (token.length >= 4) return 1
  return 0
}

interface FieldMatch {
  score: number
  range: [number, number] | null
}

const NO_MATCH: FieldMatch = { score: 0, range: null }

/**
 * Match one term against one field (label or value). Returns the strongest
 * signal found:
 *   word-start substring 100 · mid-word substring 70 · typo-word 40
 */
function matchField(
  fieldLower: string,
  term: string,
  allowTypo: boolean,
): FieldMatch {
  const index = fieldLower.indexOf(term)
  if (index >= 0) {
    const atWordStart =
      index === 0 || !/[a-z0-9]/.test(fieldLower[index - 1] ?? '')
    return {
      score: atWordStart ? 100 : 70,
      range: [index, index + term.length],
    }
  }
  // Typo tolerance applies to what the employee TYPED, never to alias
  // expansions — fuzzing canonical terms stacks two approximations and
  // matches junk ("inputs"→alias "ports"→typo "parts").
  if (!allowTypo) return NO_MATCH
  const budget = typoBudget(term)
  if (budget === 0) return NO_MATCH
  // Compare against each word of the field.
  const wordPattern = /[a-z0-9]+/g
  let match = wordPattern.exec(fieldLower)
  while (match !== null) {
    if (editDistance(match[0], term) <= budget) {
      return { score: 40, range: [match.index, match.index + match[0].length] }
    }
    match = wordPattern.exec(fieldLower)
  }
  return NO_MATCH
}

interface RowMatch {
  score: number
  labelRange: [number, number] | null
  valueRange: [number, number] | null
}

/** Best signal for one query token against a row, aliases included. */
function matchToken(
  labelLower: string,
  valueLower: string,
  token: string,
): RowMatch | null {
  let best: RowMatch | null = null

  const consider = (
    labelHit: FieldMatch,
    valueHit: FieldMatch,
    weight: number,
  ) => {
    // Label matches outrank value matches at equal strength: the employee
    // usually knows the attribute name, not the value.
    const score = Math.max(labelHit.score * 1.2, valueHit.score) * weight
    if (score <= 0) return
    if (best === null || score > best.score) {
      best = {
        score,
        labelRange: labelHit.range,
        valueRange: valueHit.range,
      }
    }
  }

  consider(
    matchField(labelLower, token, true),
    matchField(valueLower, token, true),
    1,
  )

  // Alias expansion at a discount so direct hits always outrank them.
  for (const term of aliasTermsFor(token)) {
    consider(
      matchField(labelLower, term, false),
      matchField(valueLower, term, false),
      0.6,
    )
  }

  return best
}

/**
 * Search rows. Empty/whitespace query returns everything unranked (the UI
 * treats that as "no filter"). Multi-token queries AND their tokens.
 */
export function searchSpecs(rows: SpecRow[], query: string): SpecMatch[] {
  const tokens = normalizeToken(query).split(' ').filter(Boolean)
  if (tokens.length === 0) {
    return rows.map((row) => ({
      row,
      score: 0,
      labelRanges: [],
      valueRanges: [],
    }))
  }

  const matches: SpecMatch[] = []
  for (const row of rows) {
    const labelLower = row.label.toLowerCase()
    const valueLower = row.value.toLowerCase()
    let total = 0
    const labelRanges: [number, number][] = []
    const valueRanges: [number, number][] = []
    let failed = false

    for (const token of tokens) {
      const hit = matchToken(labelLower, valueLower, token)
      if (hit === null) {
        failed = true
        break
      }
      total += hit.score
      if (hit.labelRange) labelRanges.push(hit.labelRange)
      if (hit.valueRange) valueRanges.push(hit.valueRange)
    }

    if (!failed) {
      matches.push({
        row,
        score: total,
        labelRanges: mergeRanges(labelRanges),
        valueRanges: mergeRanges(valueRanges),
      })
    }
  }

  // Stable by construction: sort() in JS is stable, so equal scores keep
  // spec-sheet order (curated rows first).
  return matches.sort((a, b) => b.score - a.score)
}

/** Merge overlapping highlight ranges so <mark>s never nest. */
export function mergeRanges(ranges: [number, number][]): [number, number][] {
  if (ranges.length <= 1) return ranges
  const sorted = [...ranges].sort((a, b) => a[0] - b[0])
  const out: [number, number][] = [sorted[0]]
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1]
    const next = sorted[i]
    if (next[0] <= last[1]) last[1] = Math.max(last[1], next[1])
    else out.push([next[0], next[1]])
  }
  return out
}
