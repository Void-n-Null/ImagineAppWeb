import { describe, expect, it } from 'vitest'
import { extractDigitCandidates, pickAutoCandidate } from './ocr-digits'

describe('extractDigitCandidates', () => {
  // --- realistic floor blobs ----------------------------------------------

  it('pulls the 7-digit SKU out of a Best Buy fact tag', () => {
    const tag =
      'Insignia 50" F50 Series LED 4K UHD Smart Fire TV\n' +
      'SKU: 6636938  Model NS-50F501NA22\n' +
      'Reg. $299.99'
    // 6636938 (SKU, tier 0) beats any UPC-length run; the model number has no
    // pure 4-14 digit run (letters break it). $299.99 → 299 / 99, both < 4.
    expect(extractDigitCandidates(tag)[0]).toBe('6636938')
    expect(extractDigitCandidates(tag)).toContain('6636938')
  })

  it('extracts the SKU embedded in a bestbuy.com URL on a monitor', () => {
    const url =
      'bestbuy.com/site/insignia-50-f50-series/6636938.p?skuId=6636938'
    // Two occurrences of 6636938; dedupe keeps one.
    expect(extractDigitCandidates(url)).toEqual(['6636938'])
  })

  // --- prices must not fabricate long runs --------------------------------

  it('never turns a comma/period price into a 4+ digit run', () => {
    // $1,299.99 → runs 1 / 299 / 99 — all sub-threshold, so nothing survives.
    expect(extractDigitCandidates('$1,299.99')).toEqual([])
  })

  it('DOES read a comma-less price as a 4-digit run, ranked last', () => {
    // $1299.99 → 1299 (4-digit) + 99. The 4-digit run is a real risk (prices,
    // years, quantities) — it survives but sits in the lowest tier. Documented
    // here so the ranking contract is explicit.
    expect(extractDigitCandidates('$1299.99')).toEqual(['1299'])
    // A true SKU alongside it must outrank the price fragment.
    expect(extractDigitCandidates('$1299.99 SKU 6636938')[0]).toBe('6636938')
  })

  // --- spaced UPC under a barcode -----------------------------------------

  it('recovers a space-grouped UPC printed under its bars', () => {
    // Human-readable UPC line: `0 12345 67890 5`. Broken on spaces every group
    // is < 4; the collapse 012345678905 (12 = UPC-A) is what we want.
    const out = extractDigitCandidates('0 12345 67890 5')
    expect(out).toContain('012345678905')
    expect(out[0]).toBe('012345678905')
  })

  it('does not fuse separate numbers when the blob is not pure digits+spaces', () => {
    // Real tag text: letters present, so the spaced-collapse recovery is OFF.
    // Only the genuine 7-digit run is returned.
    expect(extractDigitCandidates('SKU 6636938 QTY 12 34')).toEqual(['6636938'])
  })

  it('recovers a spaced UPC on its own line in multi-line OCR output', () => {
    // The digit whitelist still yields multi-line text (a frame reads several
    // tag regions). The spaced-collapse must work PER LINE — the whole blob is
    // not pure digits+spaces, but the UPC line is.
    const out = extractDigitCandidates('6636938\n0 12345 67890 5\n2024')
    expect(out).toContain('012345678905')
    expect(out[0]).toBe('6636938') // 7-digit SKU still outranks the UPC
  })

  it('does not fuse digit groups across lines', () => {
    // Fused across the newline these would form a 12-digit "UPC"; they are two
    // unrelated 6-digit reads and must stay that way.
    expect(extractDigitCandidates('123456\n789012')).toEqual([
      '123456',
      '789012',
    ])
  })

  // --- length gates --------------------------------------------------------

  it('discards runs longer than 14 digits (serials / gift cards)', () => {
    expect(extractDigitCandidates('GIFT 123456789012345678')).toEqual([])
  })

  it('keeps a 14-digit GTIN but drops a 15-digit run', () => {
    expect(extractDigitCandidates('12345678901234')).toEqual(['12345678901234'])
    expect(extractDigitCandidates('123456789012345')).toEqual([])
  })

  it('discards runs shorter than 4 digits', () => {
    expect(extractDigitCandidates('12 3 999')).toEqual([])
  })

  // --- empty / garbage -----------------------------------------------------

  it('returns [] for empty input', () => {
    expect(extractDigitCandidates('')).toEqual([])
  })

  it('returns [] for garbage with no in-window digit runs', () => {
    expect(extractDigitCandidates('~~~ no numbers here!! ~~~')).toEqual([])
  })

  // --- dedupe --------------------------------------------------------------

  it('dedupes repeated runs, preserving first occurrence', () => {
    expect(extractDigitCandidates('6636938 foo 6636938 bar 6636938')).toEqual([
      '6636938',
    ])
  })

  // --- ranking order -------------------------------------------------------

  it('ranks SKU-length (7-8) above UPC above padded SKU above 4-digit', () => {
    // One of each tier, presented in reverse-plausibility order to prove the
    // sort (not input order) decides the final ranking. 8-digit runs are SKU
    // tier alongside 7 (newer SKU issues), and both sit ABOVE UPC lengths:
    // a UPC comes with a barcode the barcode loop already reads; a printed
    // SKU never does.
    const blob = '1984 123456789012 123456789 12345678 6636938'
    //            4(t4)  UPC-A(t1)    9-dig(t2)  8(t0)     7(t0)
    expect(extractDigitCandidates(blob)).toEqual([
      '12345678', // tier 0, first seen
      '6636938', // tier 0
      '123456789012', // tier 1
      '123456789', // tier 2
    ])
  })

  it('keeps input order for runs in the same tier (stable)', () => {
    // Two 7-digit SKUs — both tier 0 — must stay in read order.
    expect(extractDigitCandidates('7000001 then 7000002')).toEqual([
      '7000001',
      '7000002',
    ])
  })

  // --- cap -----------------------------------------------------------------

  it('caps the result at 4 candidates', () => {
    const blob = '6000001 6000002 6000003 6000004 6000005 6000006'
    const out = extractDigitCandidates(blob)
    expect(out).toHaveLength(4)
    expect(out).toEqual(['6000001', '6000002', '6000003', '6000004'])
  })
})

describe('pickAutoCandidate', () => {
  it('prefers a SKU-shaped run (7-8) over a UPC-shaped one', () => {
    // Ranked input (as extractDigitCandidates produces): SKU first anyway —
    // but even from a UPC-first list, the SKU shape must win.
    expect(pickAutoCandidate(['123456789012', '6636938'])).toBe('6636938')
    expect(pickAutoCandidate(['123456789012', '12345678'])).toBe('12345678')
  })

  it('falls back to a UPC-shaped run (11-14) when no SKU shape exists', () => {
    expect(pickAutoCandidate(['123456789012'])).toBe('123456789012')
    expect(pickAutoCandidate(['12345678901234'])).toBe('12345678901234')
  })

  it('refuses low-confidence shapes — auto mode must not fire on floor noise', () => {
    // 4-6, 9-10 digit runs: aisle numbers, quantities, padded/legacy lengths.
    // Plausible enough to TRY on an explicit action, not to auto-fire on.
    expect(pickAutoCandidate(['1984'])).toBeNull()
    expect(pickAutoCandidate(['123456', '1234567890'])).toBeNull()
    expect(pickAutoCandidate([])).toBeNull()
  })

  it('takes the first match in rank order within a shape', () => {
    expect(pickAutoCandidate(['7000001', '7000002'])).toBe('7000001')
  })
})
