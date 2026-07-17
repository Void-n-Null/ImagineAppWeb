/**
 * EAN-13 / UPC-A encoder (IMA-11) — pure data, no DOM.
 *
 * Hand-rolled instead of a dependency: retail barcodes are a fixed 95-module
 * grid with published patterns (GS1 General Specifications), an encoder is
 * ~100 lines, and owning it means the scan-mode rendering (quiet zones,
 * guard-bar extension, module crispness) is fully under our control — those
 * are exactly the parameters register scanners are picky about.
 *
 * UPC-A is EAN-13 with a leading zero; both encode to the same 95 modules.
 * We keep the distinction anyway because the HUMAN-readable layout differs
 * (UPC-A shows 12 digits with the first/last outside the guards, matching
 * what's printed on US shelf tags — the employee eyeballs that match).
 */

/** Left-hand odd-parity patterns (L), one 7-module pattern per digit. */
const L_CODES = [
  '0001101',
  '0011001',
  '0010011',
  '0111101',
  '0100011',
  '0110001',
  '0101111',
  '0111011',
  '0110111',
  '0001011',
] as const

/** Right-hand patterns (R) — the bitwise complement of L. */
const R_CODES = [
  '1110010',
  '1100110',
  '1101100',
  '1000010',
  '1011100',
  '1001110',
  '1010000',
  '1000100',
  '1001000',
  '1110100',
] as const

/** Left-hand even-parity patterns (G) — R reversed. */
const G_CODES = R_CODES.map((code) => [...code].reverse().join(''))

/**
 * First-digit parity map for the six left-hand digits of an EAN-13.
 * 'L' = odd parity, 'G' = even. A leading 0 (i.e. UPC-A) is all-L.
 */
const PARITY = [
  'LLLLLL',
  'LLGLGG',
  'LLGGLG',
  'LLGGGL',
  'LGLLGG',
  'LGGLLG',
  'LGGGLL',
  'LGLGLG',
  'LGLGGL',
  'LGGLGL',
] as const

const GUARD = '101'
const CENTER = '01010'

/** GTIN check digit (works for any length: UPC-A, EAN-13, …). */
export function checkDigit(dataDigits: string): number {
  let sum = 0
  // Weights 3/1 alternate from the RIGHTMOST data digit (weight 3).
  for (let i = 0; i < dataDigits.length; i++) {
    const digit = dataDigits.charCodeAt(dataDigits.length - 1 - i) - 48
    sum += i % 2 === 0 ? digit * 3 : digit
  }
  return (10 - (sum % 10)) % 10
}

function hasValidCheckDigit(digits: string): boolean {
  return (
    checkDigit(digits.slice(0, -1)) ===
    digits.charCodeAt(digits.length - 1) - 48
  )
}

/** 95 booleans (true = dark module) for a 13-digit EAN-13 string. */
function ean13Modules(digits13: string): boolean[] {
  const first = digits13.charCodeAt(0) - 48
  const parity = PARITY[first]
  let pattern = GUARD
  for (let i = 1; i <= 6; i++) {
    const digit = digits13.charCodeAt(i) - 48
    pattern += parity[i - 1] === 'L' ? L_CODES[digit] : G_CODES[digit]
  }
  pattern += CENTER
  for (let i = 7; i <= 12; i++) {
    pattern += R_CODES[digits13.charCodeAt(i) - 48]
  }
  pattern += GUARD
  return [...pattern].map((bit) => bit === '1')
}

export interface EncodedBarcode {
  format: 'upc-a' | 'ean-13'
  /** Digits as displayed (12 for UPC-A, 13 for EAN-13), check digit included. */
  digits: string
  /** The 95-module symbol; true = dark bar. */
  modules: boolean[]
}

/**
 * Encode a raw catalog UPC string into a renderable retail barcode.
 *
 * Accepts what Best Buy's `upc` field actually contains in the wild:
 * - 12 digits → UPC-A (check digit verified — a corrupt code would scan as
 *   the WRONG product at a register, which is worse than no barcode)
 * - 11 digits → UPC-A with the check digit computed (some feeds drop it)
 * - 13 digits → EAN-13; a leading zero renders as UPC-A (identical symbol,
 *   US shelf-tag layout)
 *
 * Returns null for anything else — callers fall back to showing the SKU,
 * which registers can key in manually.
 */
export function encodeRetailBarcode(raw: string): EncodedBarcode | null {
  let digits = raw.replace(/\D/g, '')

  if (digits.length === 11) digits += String(checkDigit(digits))
  if (digits.length === 13 && digits.startsWith('0')) digits = digits.slice(1)

  if (digits.length === 12) {
    if (!hasValidCheckDigit(digits)) return null
    return {
      format: 'upc-a',
      digits,
      modules: ean13Modules(`0${digits}`),
    }
  }
  if (digits.length === 13) {
    if (!hasValidCheckDigit(digits)) return null
    return { format: 'ean-13', digits, modules: ean13Modules(digits) }
  }
  return null
}
