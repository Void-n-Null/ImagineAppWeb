/**
 * Credit → human copy for the Settings surface (IMA-32, IMA-16 #366).
 *
 * The caption estimates how many floor questions a balance buys ON THE
 * CURRENTLY SELECTED MODEL, scaling a MEASURED anchor by relative pricing.
 * The count is never promised exactly — model spend is variable — so the copy
 * hedges with "about" and pluralizes cleanly.
 */

/**
 * Per-question token profile from the measured E2E runs (IMA-16, 2026-07-07,
 * 12 floor questions / 26 calls, gemini-3.1-flash-lite).
 */
const PROMPT_TOKENS_PER_Q = 21_865
const COMPLETION_TOKENS_PER_Q = 337

/**
 * Measured $/question actually billed on flash-lite (2026-07-07 anchor run).
 * This is the BILLED figure — it already bakes in implicit cache discounts, so
 * it's ~2x lower than raw price math would predict. We scale THIS by relative
 * pricing rather than trusting raw price math end-to-end.
 */
const ANCHOR_COST_PER_QUESTION = 0.00273

/** flash-lite catalog fallback ($/1M) when the live entry isn't available. */
const FLASH_LITE_INPUT_PER_M = 0.25
const FLASH_LITE_OUTPUT_PER_M = 1.5

/** A credit is worth $0.005 of spend. */
const USD_PER_CREDIT = 0.005

/** Model pricing, per 1M tokens (matches ModelCost: null/undefined = unknown). */
export interface ModelPricing {
  input: number | null | undefined
  output: number | null | undefined
}

/** $/question at RAW catalog prices for a given input/output per-1M pair. */
function blended(inputPerM: number, outputPerM: number): number {
  return (
    PROMPT_TOKENS_PER_Q * 1e-6 * inputPerM +
    COMPLETION_TOKENS_PER_Q * 1e-6 * outputPerM
  )
}

/** flash-lite's raw blended $/question — the ratio denominator. */
const FLASH_LITE_BLENDED = blended(
  FLASH_LITE_INPUT_PER_M,
  FLASH_LITE_OUTPUT_PER_M,
)

/**
 * Estimate how many questions `credits` buys on `model`. Returns null when the
 * model's pricing is unavailable (the caption then falls back to flat wording).
 *
 *   blended(model)  = 21_865e-6 * inputPerM + 337e-6 * outputPerM   // raw $/q
 *   ratio(model)    = blended(model) / blended(flash-lite)
 *   costPerQuestion = 0.00273 * ratio(model)     // scale the MEASURED anchor
 *   questions       = floor((credits * 0.005) / costPerQuestion)
 */
export function estimateQuestions(
  credits: number,
  model: ModelPricing | undefined,
): number | null {
  if (credits <= 0) return 0
  const input = model?.input
  const output = model?.output
  if (input == null || output == null) return null

  const ratio = blended(input, output) / FLASH_LITE_BLENDED
  const costPerQuestion = ANCHOR_COST_PER_QUESTION * ratio
  if (!Number.isFinite(costPerQuestion) || costPerQuestion <= 0) return null

  return Math.floor((credits * USD_PER_CREDIT) / costPerQuestion)
}

/**
 * "about 183 questions on Gemini 3.1 Flash Lite" when we know the model's
 * pricing; the flat "roughly N questions" when we don't; "no questions left"
 * for a non-positive balance. `modelName` is the display name of the currently
 * selected model.
 */
export function questionsCaption(
  credits: number,
  model?: ModelPricing,
  modelName?: string,
): string {
  const flat = Math.max(0, Math.floor(credits))
  if (flat <= 0) return 'no questions left'

  const estimate = estimateQuestions(credits, model)
  if (estimate == null || !modelName) {
    // No model pricing (or no name): keep the honest flat wording.
    return `roughly ${flat} question${flat === 1 ? '' : 's'}`
  }
  if (estimate <= 0) return 'no questions left'

  return `about ${estimate} question${estimate === 1 ? '' : 's'} on ${modelName}`
}
