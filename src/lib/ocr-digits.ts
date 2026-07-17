/**
 * OCR → digit-candidate extraction (IMA-39).
 *
 * On-device Tesseract reads any printed/displayed number the associate points
 * the camera at — a SKU on a coworker's monitor, a Best Buy fact tag, a paper
 * pick list, bestbuy.com on a customer's phone. This module is the PURE string
 * layer between that noisy OCR text and the existing scan-lookup pipeline: it
 * pulls plausible product-code digit runs out of the text and ranks them so the
 * most-likely SKU/UPC is tried first.
 *
 * It has NO tesseract dependency on purpose — it's trivially unit-testable
 * against realistic OCR blobs (see ocr-digits.test.ts), and the OCR hook simply
 * feeds it `result.data.text`.
 *
 * The output flows UNCHANGED into `lookupScannedProduct({ format: 'ocr', … })`:
 * `identifyScan`'s unknown-format branch already classifies a bare digit run by
 * length (4-10 → SKU, 11-14 → UPC with GTIN normalization), so a single
 * candidate resolves end-to-end with zero server changes.
 */

/** Product-code length window. Runs shorter than 4 can't be a SKU; runs longer
 *  than 14 are serials / gift-card numbers (and overflow a safe JS integer),
 *  never products — both are discarded before ranking. */
const MIN_LEN = 4
const MAX_LEN = 14

/**
 * Every maximal digit run in `text` whose length is in [4, 14]. Runs are broken
 * by ANY non-digit character (spaces, `.,-$`, letters), which is deliberate:
 * it keeps a price like `$1,299.99` from ever forming one long run (it yields
 * `1` / `299` / `99`, all < 4), and stops a phone number's dashes or a model
 * string's letters from gluing unrelated groups together.
 */
function rawDigitRuns(text: string): string[] {
  return (
    text
      .match(/\d+/g)
      ?.filter((run) => run.length >= MIN_LEN && run.length <= MAX_LEN) ?? []
  )
}

/**
 * A UPC-family barcode printed under its bars is often OCR'd WITH the space
 * grouping the human-readable line uses: `0 12345 67890 5`. Broken on spaces
 * that gives `0` / `12345` / `67890` / `5` — four sub-threshold runs and a lost
 * product code. So we ALSO consider, PER LINE, the digits-only collapse when a
 * line is purely digits-and-spaces and collapses to one valid UPC length
 * (11-14). Per line — not the whole text — because the digit whitelist still
 * yields multi-line output (a frame usually reads several tag regions), and
 * fusing across lines would glue unrelated numbers together.
 */
function spacedUpcRuns(text: string): string[] {
  const out: string[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!/^\d[\d ]*\d$/.test(trimmed) || !trimmed.includes(' ')) continue
    const joined = trimmed.replace(/ /g, '')
    if (joined.length >= 11 && joined.length <= 14) out.push(joined)
  }
  return out
}

/**
 * Rank a run by how likely it is to be a Best Buy product code the associate
 * actually meant. Lower tier = tried first.
 *  0  7-8 digits — SKU lengths (7 = the bulk of the current catalog, 8 = newer
 *     issues). SKU beats UPC deliberately: a UPC is almost always printed WITH
 *     its barcode (which the barcode loop reads better than OCR ever will),
 *     while a bare printed SKU — fact tag, monitor, pick list — never has one.
 *     OCR's whole job is the SKU case.
 *  1  12/13/14 — UPC-A / EAN-13 / GTIN-14 printed on a box.
 *  2  6 or 9-10 — legacy or zero-padded SKUs.
 *  3  11 — an unusual UPC-ish length; below padded SKUs.
 *  4  4-5 — old short SKUs, but the dominant source of 4-5 digit runs on a tag
 *          is years, quantities, and model fragments, so they rank LAST.
 */
function tier(run: string): number {
  const n = run.length
  if (n === 7 || n === 8) return 0
  if (n >= 12 && n <= 14) return 1
  if (n === 6 || n === 9 || n === 10) return 2
  if (n === 11) return 3
  return 4 // 4-5
}

/** Max candidates handed to the UI / lookup. Four covers a busy fact tag
 *  (SKU + UPC + model-embedded digits) without turning the chip strip into a
 *  guessing game. */
const MAX_CANDIDATES = 4

/**
 * Extract ranked, deduped digit candidates from raw OCR text.
 *
 * Order of operations:
 * 1. Collect all in-window digit runs, plus the spaced-UPC recovery.
 * 2. Dedupe preserving FIRST occurrence (stable input order before ranking).
 * 3. Stable-sort by plausibility tier (ties keep input order).
 * 4. Cap at {@link MAX_CANDIDATES}.
 */
export function extractDigitCandidates(text: string): string[] {
  if (!text) return []

  const all = [...spacedUpcRuns(text), ...rawDigitRuns(text)]

  // Dedupe, first-occurrence wins.
  const seen = new Set<string>()
  const unique: string[] = []
  for (const run of all) {
    if (!seen.has(run)) {
      seen.add(run)
      unique.push(run)
    }
  }

  // Stable sort by tier. Array.prototype.sort is stable in modern JS engines,
  // so equal tiers retain their first-seen order.
  return unique.sort((a, b) => tier(a) - tier(b)).slice(0, MAX_CANDIDATES)
}

/**
 * The hands-free auto-fire rule (IMA-39 v2): the continuous OCR loop acts on
 * its own — no button, no chips — so it only trusts the two HIGH-confidence
 * shapes and ignores everything else as floor noise (aisle numbers, quantities,
 * price fragments, padded/legacy lengths):
 * - a 7-8 digit run → SKU (preferred — see {@link tier} for why SKU > UPC)
 * - else an 11-14 digit run → UPC family
 * Candidates arrive already ranked, so the first match per shape wins.
 */
export function pickAutoCandidate(candidates: string[]): string | null {
  return (
    candidates.find((c) => c.length === 7 || c.length === 8) ??
    candidates.find((c) => c.length >= 11 && c.length <= 14) ??
    null
  )
}
