/**
 * Benchmark question schema + objective scoring (IMA model audit).
 *
 * A question passes or fails on the agent's FINAL answer text (all assistant
 * prose from the turn, concatenated) — no LLM judge, no vibes. Two primitive
 * checks cover everything:
 *
 *  - sku:       the answer must reference at least one of the listed SKUs
 *               (rendered as [Product(6534483)] / [Compare(...)] cards or raw
 *               digits — we match the digit string).
 *  - substring: the answer must contain at least one of the listed strings
 *               (case-insensitive). Use for spec values ("120Hz"), product
 *               names, yes/no facts phrased as required words.
 *
 * Combinators `allOf` / `anyOf` compose them. Keep tolerance INSIDE the
 * check (e.g. top-3 SKUs for a popularity question) — the runner is binary.
 */

export type Concept = 'search' | 'compare' | 'qa'
export type Difficulty = 'easy' | 'medium' | 'hard'

export type Check =
  | { kind: 'sku'; skus: number[] }
  | { kind: 'substring'; values: string[] }
  | { kind: 'allOf'; checks: Check[] }
  | { kind: 'anyOf'; checks: Check[] }

export interface BenchQuestion {
  /** Stable id, `<concept>-<difficulty>-<n>` (e.g. "search-easy-1"). */
  id: string
  concept: Concept
  difficulty: Difficulty
  /** The user message, exactly as a floor employee would type it. */
  prompt: string
  check: Check
  /**
   * Grounding evidence: which tool call(s) verified the answer and what they
   * returned, with the date. A question without evidence is not objective.
   */
  notes: string
}

/**
 * Typography normalization — applied identically to answers AND check values
 * so cosmetic formatting can't flunk a correct answer. Discovered via
 * inception/mercury-2, which writes "WH‑1000XM5" (U+2011 non-breaking
 * hyphen) and "240 Hz" (spaced unit): 16 of its 27 "fails" were this, not
 * wrong answers.
 *
 *  - Unicode hyphens/dashes/minus → ASCII '-'
 *  - NBSP / thin / zero-width spaces → plain space
 *  - the gap between a digit and a following letter/% collapses
 *    ("240 Hz" ≡ "240Hz", "512 GB" ≡ "512GB")
 *  - lowercased
 */
export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u00A0\u2000-\u200B\u202F\uFEFF]/g, ' ')
    .replace(/(\d) +(?=[a-z%])/g, '$1')
}

export function evaluateCheck(check: Check, answer: string): boolean {
  return evaluateNormalized(check, normalizeForMatch(answer))
}

function evaluateNormalized(check: Check, haystack: string): boolean {
  switch (check.kind) {
    case 'sku':
      return check.skus.some((sku) => haystack.includes(String(sku)))
    case 'substring':
      return check.values.some((v) => haystack.includes(normalizeForMatch(v)))
    case 'allOf':
      return check.checks.every((c) => evaluateNormalized(c, haystack))
    case 'anyOf':
      return check.checks.some((c) => evaluateNormalized(c, haystack))
  }
}

/** Sanity guard for question files: throws on structural mistakes. */
export function validateQuestions(questions: BenchQuestion[]): void {
  const seen = new Set<string>()
  for (const q of questions) {
    if (seen.has(q.id)) throw new Error(`duplicate question id: ${q.id}`)
    seen.add(q.id)
    if (!q.prompt.trim()) throw new Error(`${q.id}: empty prompt`)
    if (!q.notes.trim()) throw new Error(`${q.id}: missing grounding notes`)
    assertCheck(q.check, q.id)
  }
}

function assertCheck(check: Check, id: string): void {
  switch (check.kind) {
    case 'sku':
      if (check.skus.length === 0) throw new Error(`${id}: empty sku list`)
      for (const sku of check.skus) {
        if (!Number.isSafeInteger(sku) || sku <= 0)
          throw new Error(`${id}: bad sku ${sku}`)
      }
      return
    case 'substring':
      if (check.values.length === 0)
        throw new Error(`${id}: empty substring list`)
      if (check.values.some((v) => v.trim().length < 2))
        throw new Error(`${id}: substring too short to be meaningful`)
      return
    case 'allOf':
    case 'anyOf':
      if (check.checks.length === 0) throw new Error(`${id}: empty combinator`)
      for (const c of check.checks) assertCheck(c, id)
      return
  }
}
