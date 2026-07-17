import { describe, expect, it } from 'vitest'
import { checkDigit, encodeRetailBarcode } from './encode'

/** Render modules as a bit string for pattern assertions. */
function bits(modules: boolean[]): string {
  return modules.map((m) => (m ? '1' : '0')).join('')
}

describe('checkDigit', () => {
  it('computes the classic UPC-A example (03600029145 → 2)', () => {
    expect(checkDigit('03600029145')).toBe(2)
  })

  it('computes the GS1 EAN-13 example (590123412345 → 7)', () => {
    expect(checkDigit('590123412345')).toBe(7)
  })

  it('handles the wrap case where the sum is a multiple of 10', () => {
    // 000000000000 → sum 0 → check 0
    expect(checkDigit('000000000000')).toBe(0)
  })
})

describe('encodeRetailBarcode', () => {
  it('encodes a valid 12-digit UPC-A', () => {
    const encoded = encodeRetailBarcode('036000291452')
    expect(encoded).not.toBeNull()
    expect(encoded?.format).toBe('upc-a')
    expect(encoded?.digits).toBe('036000291452')
    expect(encoded?.modules).toHaveLength(95)
  })

  it('produces the published module pattern for EAN-13 5901234123457', () => {
    const encoded = encodeRetailBarcode('5901234123457')
    expect(encoded?.format).toBe('ean-13')
    // Reference encoding for the standard GS1 sample (parity LGGLGL):
    expect(bits(encoded?.modules ?? [])).toBe(
      '10100010110100111011001100100110111101001110101010110011011011001000010101110010011101000100101',
    )
  })

  it('starts and ends with guard patterns and has the center pattern', () => {
    const encoded = encodeRetailBarcode('036000291452')
    const pattern = bits(encoded?.modules ?? [])
    expect(pattern.startsWith('101')).toBe(true)
    expect(pattern.endsWith('101')).toBe(true)
    expect(pattern.slice(45, 50)).toBe('01010')
  })

  it('UPC-A encodes identically to its zero-prefixed EAN-13', () => {
    const upc = encodeRetailBarcode('036000291452')
    const ean = encodeRetailBarcode('0036000291452')
    // Leading-zero EAN-13 input renders as UPC-A (same symbol family).
    expect(ean?.format).toBe('upc-a')
    expect(bits(ean?.modules ?? [])).toBe(bits(upc?.modules ?? []))
  })

  it('completes an 11-digit UPC missing its check digit', () => {
    const encoded = encodeRetailBarcode('03600029145')
    expect(encoded?.digits).toBe('036000291452')
    expect(encoded?.format).toBe('upc-a')
  })

  it('rejects a 12-digit code with a bad check digit', () => {
    expect(encodeRetailBarcode('036000291453')).toBeNull()
  })

  it('rejects a 13-digit code with a bad check digit', () => {
    expect(encodeRetailBarcode('5901234123450')).toBeNull()
  })

  it('strips non-digit noise before encoding', () => {
    expect(encodeRetailBarcode(' 036000-291452 ')?.digits).toBe('036000291452')
  })

  it('returns null for unencodable lengths', () => {
    expect(encodeRetailBarcode('')).toBeNull()
    expect(encodeRetailBarcode('12345')).toBeNull()
    expect(encodeRetailBarcode('12345678901234')).toBeNull()
    expect(encodeRetailBarcode('no digits here')).toBeNull()
  })
})
