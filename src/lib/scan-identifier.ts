/**
 * Classify a raw scanner hit into an ordered list of Best Buy lookup candidates.
 *
 * Real-world sources on the floor (each shapes a rule below):
 * - Product boxes: UPC-A/EAN-13 barcodes → `upc=` lookup.
 * - Best Buy in-store LMD QR: the most common QR on modern shelf tags. Encodes
 *   `http://bby.us/?c=BB<5-digit store #><SKU>&LMD=true` — the `c` param is
 *   `BB` + a 5-digit store number + the SKU. We pull the SKU tail out of it.
 * - Best Buy spec/product-page QR: bestbuy.com URLs carrying `skuId=…` or a
 *   `/1234567.p` product-page path → `sku=` lookup.
 * - Legacy shelf tags / cartons: Code 128 / Code 39 / ITF encoding the bare SKU
 *   or a GTIN-14, plus signage QRs that embed "SKU: 1234567" as plain text.
 *
 * The function returns a *prioritized* candidate list rather than a single
 * identifier: a payload is often ambiguous (an 11-14 digit run could be a UPC
 * or a padded SKU), and the caller resolves ambiguity by trying candidates
 * against the Best Buy API in order (see lookup-scanned-product.ts). This
 * subsumes v1's `fallbackToSku` flag with an explicit, testable ordering.
 *
 * Ported for parity with v1 (flutter/ImagineApp/lib/widgets/scan_product_page.dart,
 * `_lookupProductFromQrCode`). Deviations from v1 are called out inline.
 */

export type ProductIdentifier =
  | { kind: 'sku'; sku: number }
  | { kind: 'upc'; upc: string }

/**
 * The classification result. Either at least one ordered candidate, or an empty
 * list with a reason the UI can surface:
 * - `too_short`: a pure-numeric payload under 4 digits (can't be a SKU/UPC).
 * - `not_product`: structurally not a product code (wifi QR, unrelated URL,
 *   text with no embeddable digit run, non-digit 1D payload).
 */
export type ScanClassification =
  | { candidates: [ProductIdentifier, ...ProductIdentifier[]] }
  | { candidates: []; reason: 'too_short' | 'not_product' }

/** SKUs are 4-10 digits. Current catalog uses 7; older items are shorter, and
 *  padded/legacy encodings occasionally push to 10. (v1 used 6-10 in its QR
 *  path but the barcode paths accepted shorter — we unify on 4-10.) */
const SKU_MIN = 4
const SKU_MAX = 10

/** bby.us in-store LMD QR: `BB` + 5-digit store number + SKU tail. */
const BBY_LMD_RE = /bby\.us\/?\?c=BB\d{5}(\d+)/i
/** bestbuy.com product-page / spec URLs. */
const URL_SKU_ID_RE = /[?&/;:](?:skuId|skuid)=(\d{4,10})\b/
const URL_PRODUCT_PAGE_RE = /\/(\d{4,10})\.p(?:$|[?#])/
/** Signage QRs embed the SKU in plain text ("SKU: 1234567"): first digit run. */
const DIGIT_RUN_RE = /(\d{6,10})/

/**
 * Classify a scan into ordered lookup candidates. `format` is the detector's
 * symbology string (`qr_code`, `upc_a`, `code_128`, …); `rawValue` is the
 * decoded payload.
 */
export function identifyScan(
  rawValue: string,
  format: string,
): ScanClassification {
  const value = rawValue.trim()
  if (value.length === 0) return { candidates: [], reason: 'not_product' }

  // A. QR / URL-ish payloads — checked first because a bby.us LMD QR is the most
  //    common floor scan and its digits are neither a UPC nor a bare SKU.
  if (format === 'qr_code' || value.includes('://')) {
    return classifyUrlish(value)
  }

  // B. UPC-family 1D formats: the payload IS the UPC (barring EAN-13 padding).
  switch (format) {
    case 'upc_a':
    case 'upc_e':
    case 'ean_8':
    case 'ean_13':
      if (!/^\d+$/.test(value)) return { candidates: [], reason: 'not_product' }
      return { candidates: [{ kind: 'upc', upc: normalizeUpc(value) }] }
  }

  // C. Everything else (code_128, code_39, itf, data_matrix, unknown): a bare
  //    numeric payload classified by length. Non-digit → not a product.
  if (!/^\d+$/.test(value)) return { candidates: [], reason: 'not_product' }
  return classifyDigits(value)
}

function classifyUrlish(value: string): ScanClassification {
  // 1. Best Buy in-store LMD QR (bby.us) — highest-signal, store-specific.
  const lmd = BBY_LMD_RE.exec(value)?.[1]
  if (lmd) return { candidates: [{ kind: 'sku', sku: Number(lmd) }] }

  // 2. bestbuy.com spec/product-page URLs.
  const skuId =
    URL_SKU_ID_RE.exec(value)?.[1] ?? URL_PRODUCT_PAGE_RE.exec(value)?.[1]
  if (skuId) return { candidates: [{ kind: 'sku', sku: Number(skuId) }] }

  // 3. Some tags QR-encode the bare SKU/UPC with no URL wrapper.
  if (/^\d+$/.test(value)) return classifyDigits(value)

  // 4. Non-numeric, no URL match: pull the first digit run out of signage text
  //    ("SKU: 1234567"). v1's final fallback.
  const run = DIGIT_RUN_RE.exec(value)?.[1]
  if (run) return { candidates: [{ kind: 'sku', sku: Number(run) }] }

  return { candidates: [], reason: 'not_product' }
}

/**
 * Length-based classification of a pure-digit payload, mirroring v1:
 * - 11-14 → UPC (UPC-A is 12, EAN-13 is 13, GTIN-14 is 14). Normalized to the
 *   12-digit form. v1 did NOT fall back to SKU here, so neither do we.
 * - 4-10 → SKU.
 * - < 4 → too short to be anything.
 * - > 14 → not a UPC and can't be a safe SKU integer (JS `Number` loses
 *   precision past ~15 digits; >14-digit payloads are gift cards / serials,
 *   never products). This DEVIATES from v1, whose `int64 tryParse` could ingest
 *   huge numbers — we instead treat these as not-a-product. Note: the URL/QR
 *   path never reaches here for >14 digits because `classifyUrlish` only calls
 *   this for pure-digit payloads and, having no run cap, would already have
 *   matched; the DIGIT_RUN_RE fallback (cap 10) covers text-embedded cases.
 */
function classifyDigits(digits: string): ScanClassification {
  if (digits.length < SKU_MIN) return { candidates: [], reason: 'too_short' }
  if (digits.length >= 11 && digits.length <= 14) {
    return { candidates: [{ kind: 'upc', upc: normalizeUpc(digits) }] }
  }
  if (digits.length <= SKU_MAX) {
    return { candidates: [{ kind: 'sku', sku: Number(digits) }] }
  }
  // 15+ digits: serials / gift cards, not products.
  return { candidates: [], reason: 'not_product' }
}

/**
 * Collapse a UPC-family run to Best Buy's stored 12-digit form:
 * - EAN-13 US retail is a UPC-A with a leading `0` → strip it.
 * - GTIN-14 / ITF-14 with a `00` packaging-indicator prefix → strip to 12.
 * Anything else (genuine EAN-13, 12-digit UPC-A) is left untouched.
 */
function normalizeUpc(digits: string): string {
  if (digits.length === 14 && digits.startsWith('00')) return digits.slice(2)
  if (digits.length === 13 && digits.startsWith('0')) return digits.slice(1)
  return digits
}
