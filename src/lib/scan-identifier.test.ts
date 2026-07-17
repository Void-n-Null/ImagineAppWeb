import { describe, expect, it } from 'vitest'
import { identifyScan } from './scan-identifier'

describe('identifyScan', () => {
  it('treats UPC-A barcodes as a single UPC candidate', () => {
    expect(identifyScan('194253715375', 'upc_a')).toEqual({
      candidates: [{ kind: 'upc', upc: '194253715375' }],
    })
  })

  it('normalizes zero-prefixed EAN-13 to 12-digit UPC-A', () => {
    expect(identifyScan('0194253715375', 'ean_13')).toEqual({
      candidates: [{ kind: 'upc', upc: '194253715375' }],
    })
  })

  it('keeps non-US EAN-13 untouched', () => {
    expect(identifyScan('4902430735063', 'ean_13')).toEqual({
      candidates: [{ kind: 'upc', upc: '4902430735063' }],
    })
  })

  it('rejects a non-digit UPC-family payload as not_product', () => {
    expect(identifyScan('abc', 'ean_13')).toEqual({
      candidates: [],
      reason: 'not_product',
    })
  })

  // --- bby.us in-store LMD QR ---------------------------------------------
  it('reads the SKU tail out of a bby.us LMD QR', () => {
    expect(
      identifyScan('http://bby.us/?c=BB006116636938&LMD=true', 'qr_code'),
    ).toEqual({ candidates: [{ kind: 'sku', sku: 6636938 }] })
  })

  it('reads a bby.us QR without the LMD flag', () => {
    expect(identifyScan('http://bby.us/?c=BB006116636938', 'qr_code')).toEqual({
      candidates: [{ kind: 'sku', sku: 6636938 }],
    })
  })

  it('handles https and mixed case in bby.us QRs', () => {
    expect(
      identifyScan('HTTPS://BBY.US/?c=BB006116636938&LMD=true', 'qr_code'),
    ).toEqual({ candidates: [{ kind: 'sku', sku: 6636938 }] })
  })

  // --- bestbuy.com URLs ----------------------------------------------------
  it('reads skuId out of shelf-tag QR URLs', () => {
    expect(
      identifyScan(
        'https://www.bestbuy.com/site/searchpage.jsp?skuId=6538984',
        'qr_code',
      ),
    ).toEqual({ candidates: [{ kind: 'sku', sku: 6538984 }] })
  })

  it('reads product-page .p URLs (site/<slug>/<sku>.p)', () => {
    expect(
      identifyScan(
        'https://www.bestbuy.com/site/apple-macbook-air/6538984.p?ref=tag',
        'qr_code',
      ),
    ).toEqual({ candidates: [{ kind: 'sku', sku: 6538984 }] })
  })

  // --- bare-digit QR payloads by length -----------------------------------
  it('classifies bare-digit QR payloads by length', () => {
    expect(identifyScan('6538984', 'qr_code')).toEqual({
      candidates: [{ kind: 'sku', sku: 6538984 }],
    })
    expect(identifyScan('194253715375', 'qr_code')).toEqual({
      candidates: [{ kind: 'upc', upc: '194253715375' }],
    })
  })

  it('rejects a too-short numeric QR payload', () => {
    expect(identifyScan('123', 'qr_code')).toEqual({
      candidates: [],
      reason: 'too_short',
    })
  })

  it('normalizes 13-digit leading-0 and 14-digit leading-00 QR payloads', () => {
    expect(identifyScan('0194253715375', 'qr_code')).toEqual({
      candidates: [{ kind: 'upc', upc: '194253715375' }],
    })
    expect(identifyScan('00194253715375', 'qr_code')).toEqual({
      candidates: [{ kind: 'upc', upc: '194253715375' }],
    })
  })

  it('treats an oversized numeric QR payload (16 digits) as not_product', () => {
    // 15+ digits: gift cards / serials, not a product code.
    expect(identifyScan('1234567890123456', 'qr_code')).toEqual({
      candidates: [],
      reason: 'not_product',
    })
  })

  it('extracts an embedded SKU from signage QR text', () => {
    expect(identifyScan('SKU: 6636938 — Apple Watch', 'qr_code')).toEqual({
      candidates: [{ kind: 'sku', sku: 6636938 }],
    })
  })

  it('rejects a wifi-config QR as not_product', () => {
    expect(identifyScan('WIFI:T:WPA;S:BestBuy;P:pass;;', 'qr_code')).toEqual({
      candidates: [],
      reason: 'not_product',
    })
  })

  it('rejects an unrelated URL as not_product', () => {
    expect(identifyScan('https://example.com/nothing-here', 'qr_code')).toEqual(
      { candidates: [], reason: 'not_product' },
    )
  })

  // --- other 1D symbologies ------------------------------------------------
  it('classifies Code 128 digits by length', () => {
    expect(identifyScan('6538984', 'code_128')).toEqual({
      candidates: [{ kind: 'sku', sku: 6538984 }],
    })
    expect(identifyScan('194253715375', 'code_128')).toEqual({
      candidates: [{ kind: 'upc', upc: '194253715375' }],
    })
  })

  it('classifies Code 39 numeric payloads by length', () => {
    expect(identifyScan('6538984', 'code_39')).toEqual({
      candidates: [{ kind: 'sku', sku: 6538984 }],
    })
  })

  it('normalizes an ITF-14 / GTIN-14 leading-00 payload to 12-digit UPC', () => {
    expect(identifyScan('00194253715375', 'itf')).toEqual({
      candidates: [{ kind: 'upc', upc: '194253715375' }],
    })
  })

  it('rejects short/empty/non-digit payloads on generic formats', () => {
    expect(identifyScan('', 'upc_a')).toEqual({
      candidates: [],
      reason: 'not_product',
    })
    expect(identifyScan('12', 'code_128')).toEqual({
      candidates: [],
      reason: 'too_short',
    })
    expect(identifyScan('not-digits', 'code_128')).toEqual({
      candidates: [],
      reason: 'not_product',
    })
  })
})
