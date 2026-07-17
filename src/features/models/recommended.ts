// Curated picks with machine-readable profiles — re-picked 2026-07-08 from
// MEASURED data: the 53-question floor benchmark (IMA-43, scripts/bench/),
// which runs the real agent stack (system prompt, tools, ZDR provider policy)
// and scores answers against objective SKU/spec checks. Costs are measured
// $/question on that bench, not $/token guesses.
//
// Cut in that audit:
//  - nvidia/nemotron-3-ultra-550b:free + google/gemma-4-31b-it:free —
//    LITERALLY unusable: no OpenRouter endpoint satisfies our mandatory
//    zero-data-retention policy (Best Buy ToS), every request 404s.
//  - anthropic/claude-opus-4.8 — dominated: 96% at $0.112/question vs
//    Sonnet 5's 98% at $0.027. Four times the burn for a worse score.
//  - google/gemini-3.5-flash — dominated: 96% at $0.044/question vs
//    3 Flash Preview's 96% at $0.012. (Still on the pool allowlist so
//    existing selections keep working.)
//
// The profile fields power the "help me choose" guide (guide.ts); the blurb
// is the human reason a pick earns its slot. IDs are resolved against the
// fetched catalog at render time — a missing ID simply doesn't render.

export interface PickProfile {
  /** Answer quality, 1–4. 4 = frontier-deep, 1 = fine for quick facts only. */
  quality: 1 | 2 | 3 | 4
  /** Response speed, 1–3. 3 = instant-feeling, 1 = noticeably slow. */
  speed: 1 | 2 | 3
  /** Can it read photos (shelf tags, boxes)? */
  vision: boolean
  /**
   * Credit burn per QUESTION (measured, not per-token): 1 = stretches a
   * grant to ~170 questions, 2 = ~40, 3 = ~20. 0 = free (currently none —
   * no free model survives our data-retention policy).
   */
  costTier: 0 | 1 | 2 | 3
}

/**
 * Measured numbers from the 53-question floor benchmark (IMA-43,
 * scripts/bench/results/full-run.summary.csv). These render on every model
 * selector — when the bench is re-run and the roster shifts, update here.
 */
export interface PickStats {
  /** Benchmark pass rate, percent (objective SKU/spec checks, no judge). */
  benchPercent: number
  /** Median end-to-end answer time on the bench, seconds. */
  medianSeconds: number
  /** ≈ floor questions a $0.50 grant buys, from measured $/question. */
  questionsPerGrant: number
  /** Credit burn per question relative to tier 1 (1, 4, 9). */
  burnX: number
}

export interface RecommendedPick {
  id: string
  tagline: string
  blurb: string
  profile: PickProfile
  stats: PickStats
}

export const RECOMMENDED_PICKS: RecommendedPick[] = [
  {
    id: 'google/gemini-3.1-flash-lite',
    tagline: 'The default',
    blurb:
      'What your credits are budgeted for: ~170 floor questions per grant, answers in ~3 seconds, and it nails the everyday lookups and comparisons. Stray off it only when a question gets genuinely gnarly.',
    profile: { quality: 2, speed: 3, vision: true, costTier: 1 },
    stats: {
      benchPercent: 87,
      medianSeconds: 3.3,
      questionsPerGrant: 170,
      burnX: 1,
    },
  },
  {
    id: 'google/gemini-3-flash-preview',
    tagline: 'The step-up',
    blurb:
      'Near-perfect on our floor benchmark (96%) and still flash-fast — for the questions the default fumbles. Costs about four defaults per question.',
    profile: { quality: 3, speed: 3, vision: true, costTier: 2 },
    stats: {
      benchPercent: 96,
      medianSeconds: 9.1,
      questionsPerGrant: 40,
      burnX: 4,
    },
  },
  {
    id: 'anthropic/claude-sonnet-5',
    tagline: 'Best answers',
    blurb:
      'Top score on our benchmark (98%). The pick for compatibility chains and whole-setup builds — at roughly nine defaults per question, save it for the hard calls.',
    profile: { quality: 4, speed: 2, vision: true, costTier: 3 },
    stats: {
      benchPercent: 98,
      medianSeconds: 11.6,
      questionsPerGrant: 18,
      burnX: 9,
    },
  },
]
