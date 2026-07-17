/**
 * Best Buy Bench — published results snapshot (IMA-43).
 *
 * Static by design: a benchmark page is a dated snapshot, not a live feed.
 * Numbers come from scripts/bench/results/full-run.summary.csv (the adjusted
 * merge of full-run.json + compare-hard-fix.json + mercury-2.json, re-scored
 * with typography normalization). When the bench is re-run, regenerate the
 * CSVs and update here — never silently; bump `runDate`.
 */

export interface CellScore {
  passed: number
  total: number
}

export interface BenchEntry {
  /** OpenRouter model id. */
  id: string
  /** Display name (static — the page must not depend on a catalog fetch). */
  name: string
  /** Vendor slug for logo/color (matches vendor.ts). */
  vendor: string
  /** 'ranked' = completed the run; 'unusable' = cannot run in the app at all. */
  status: 'ranked' | 'unusable'
  /** Which in-app tier this model is, if any (matches RECOMMENDED_PICKS). */
  tier?: 'The default' | 'The step-up' | 'Best answers'
  /** Selectable in the app (pool-key allowlist)? */
  inApp: boolean
  overall: CellScore
  difficulty: { easy: CellScore; medium: CellScore; hard: CellScore }
  concept: { search: CellScore; compare: CellScore; qa: CellScore }
  /** Measured USD actually billed per question (OpenRouter usage accounting). */
  costPerQuestion: number
  /** Median end-to-end answer time, seconds (tool loop included). */
  medianSeconds: number
  /** One-line editorial verdict. */
  verdict: string
}

export const BENCH_META = {
  runDate: '2026-07-08',
  questionCount: 53,
  totalSpendUsd: 11.02,
  /** Question counts per cell, for context under the breakdowns. */
  cells: {
    easy: 18,
    medium: 17,
    hard: 18,
    search: 18,
    compare: 17,
    qa: 18,
  },
} as const

export const BENCH_RESULTS: BenchEntry[] = [
  {
    id: 'anthropic/claude-sonnet-5',
    name: 'Claude Sonnet 5',
    vendor: 'anthropic',
    status: 'ranked',
    tier: 'Best answers',
    inApp: true,
    overall: { passed: 52, total: 53 },
    difficulty: {
      easy: { passed: 18, total: 18 },
      medium: { passed: 17, total: 17 },
      hard: { passed: 17, total: 18 },
    },
    concept: {
      search: { passed: 17, total: 18 },
      compare: { passed: 17, total: 17 },
      qa: { passed: 18, total: 18 },
    },
    costPerQuestion: 0.02735,
    medianSeconds: 11.6,
    verdict:
      'Top score. The one model that never flubbed a comparison or a product fact — worth the burn for the hard calls.',
  },
  {
    id: 'google/gemini-3-flash-preview',
    name: 'Gemini 3 Flash Preview',
    vendor: 'google',
    status: 'ranked',
    tier: 'The step-up',
    inApp: true,
    overall: { passed: 51, total: 53 },
    difficulty: {
      easy: { passed: 18, total: 18 },
      medium: { passed: 16, total: 17 },
      hard: { passed: 17, total: 18 },
    },
    concept: {
      search: { passed: 18, total: 18 },
      compare: { passed: 17, total: 17 },
      qa: { passed: 16, total: 18 },
    },
    costPerQuestion: 0.01209,
    medianSeconds: 9.1,
    verdict:
      'Sonnet-class score at less than half Sonnet’s burn. Perfect on search. The value pick when the default fumbles.',
  },
  {
    id: 'google/gemini-3.5-flash',
    name: 'Gemini 3.5 Flash',
    vendor: 'google',
    status: 'ranked',
    inApp: true,
    overall: { passed: 51, total: 53 },
    difficulty: {
      easy: { passed: 18, total: 18 },
      medium: { passed: 16, total: 17 },
      hard: { passed: 17, total: 18 },
    },
    concept: {
      search: { passed: 18, total: 18 },
      compare: { passed: 17, total: 17 },
      qa: { passed: 16, total: 18 },
    },
    costPerQuestion: 0.04401,
    medianSeconds: 13.2,
    verdict:
      'Ties Flash Preview on every cell — at 3.6x the cost and slower. Still selectable, no longer recommended.',
  },
  {
    id: 'anthropic/claude-opus-4.8',
    name: 'Claude Opus 4.8',
    vendor: 'anthropic',
    status: 'ranked',
    inApp: false,
    overall: { passed: 51, total: 53 },
    difficulty: {
      easy: { passed: 18, total: 18 },
      medium: { passed: 16, total: 17 },
      hard: { passed: 17, total: 18 },
    },
    concept: {
      search: { passed: 16, total: 18 },
      compare: { passed: 17, total: 17 },
      qa: { passed: 18, total: 18 },
    },
    costPerQuestion: 0.11179,
    medianSeconds: 8.0,
    verdict:
      'Scores below Sonnet at 4x Sonnet’s price. Frontier weight buys nothing on floor work — cut from the app.',
  },
  {
    id: 'google/gemini-3.1-flash-lite',
    name: 'Gemini 3.1 Flash Lite',
    vendor: 'google',
    status: 'ranked',
    tier: 'The default',
    inApp: true,
    overall: { passed: 46, total: 53 },
    difficulty: {
      easy: { passed: 16, total: 18 },
      medium: { passed: 16, total: 17 },
      hard: { passed: 14, total: 18 },
    },
    concept: {
      search: { passed: 16, total: 18 },
      compare: { passed: 15, total: 17 },
      qa: { passed: 15, total: 18 },
    },
    costPerQuestion: 0.00294,
    medianSeconds: 3.3,
    verdict:
      'The economics champion: 9x cheaper and 3x faster than anything that beats it. Hard questions are its ceiling.',
  },
  {
    id: 'inception/mercury-2',
    name: 'Mercury 2',
    vendor: 'inception',
    status: 'ranked',
    inApp: false,
    overall: { passed: 44, total: 53 },
    difficulty: {
      easy: { passed: 18, total: 18 },
      medium: { passed: 11, total: 17 },
      hard: { passed: 15, total: 18 },
    },
    concept: {
      search: { passed: 15, total: 18 },
      compare: { passed: 12, total: 17 },
      qa: { passed: 17, total: 18 },
    },
    costPerQuestion: 0.00327,
    medianSeconds: 6.7,
    verdict:
      'The diffusion challenger: perfect on easy, strong on product facts — then craters on medium and comparisons. No vision.',
  },
  {
    id: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    name: 'Nemotron 3 Ultra (free)',
    vendor: 'nvidia',
    status: 'unusable',
    inApp: false,
    overall: { passed: 0, total: 53 },
    difficulty: {
      easy: { passed: 0, total: 18 },
      medium: { passed: 0, total: 17 },
      hard: { passed: 0, total: 18 },
    },
    concept: {
      search: { passed: 0, total: 18 },
      compare: { passed: 0, total: 17 },
      qa: { passed: 0, total: 18 },
    },
    costPerQuestion: 0,
    medianSeconds: 0,
    verdict:
      'Every request refused: no provider offers it under zero-data-retention.',
  },
  {
    id: 'google/gemma-4-31b-it:free',
    name: 'Gemma 4 31B (free)',
    vendor: 'google',
    status: 'unusable',
    inApp: false,
    overall: { passed: 0, total: 53 },
    difficulty: {
      easy: { passed: 0, total: 18 },
      medium: { passed: 0, total: 17 },
      hard: { passed: 0, total: 18 },
    },
    concept: {
      search: { passed: 0, total: 18 },
      compare: { passed: 0, total: 17 },
      qa: { passed: 0, total: 18 },
    },
    costPerQuestion: 0,
    medianSeconds: 0,
    verdict:
      'Same wall: zero ZDR-compliant endpoints, so it can never answer in this app.',
  },
]

/** Ranked entries, best score first (cheapest breaks ties). */
export function rankedEntries(): BenchEntry[] {
  return BENCH_RESULTS.filter((e) => e.status === 'ranked').sort(
    (a, b) =>
      b.overall.passed - a.overall.passed ||
      a.costPerQuestion - b.costPerQuestion,
  )
}

export function unusableEntries(): BenchEntry[] {
  return BENCH_RESULTS.filter((e) => e.status === 'unusable')
}

export function pct(score: CellScore): number {
  return Math.round((score.passed / score.total) * 100)
}
