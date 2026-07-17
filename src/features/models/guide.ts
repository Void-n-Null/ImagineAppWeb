// The "help me choose" guide: four questions → one recommendation.
//
// Design rules (from the lead designer):
//   - Money is the LAST question, never earlier.
//   - If the user expects hard questions but won't spend, tell them plainly
//     that accuracy will suffer — before and after they commit to it.
// The scoring is a pure function so it's unit-testable and the UI stays dumb.

import type { PickProfile, RecommendedPick } from './recommended'

export type Complexity = 'simple' | 'compare' | 'hard'
export type Patience = 'instant' | 'patient'
/**
 * 'cheap' = stretch the credit grant (the measured-cheap default only);
 * 'best' = whatever answers best. The old 'free' tier is gone: no free model
 * survives the mandatory zero-data-retention provider policy (IMA-43 audit),
 * and pool credits mean nobody needs one.
 */
export type Budget = 'best' | 'cheap'

export interface GuideAnswers {
  complexity: Complexity
  photos: boolean
  patience: Patience
  budget: Budget
}

/**
 * How much model quality each kind of work actually needs. Note compare = 3:
 * weighing options with real nuance is exactly what separates the q3 models
 * from the q2 "fine for facts" tier — a q2 model meeting 'compare' only on
 * paper is how you end up recommending the wrong TV.
 */
const QUALITY_NEED: Record<Complexity, number> = {
  simple: 1,
  compare: 3,
  hard: 4,
}

export type AccuracyWarning = 'strong' | 'mild' | null

export interface GuideResult {
  pick: RecommendedPick
  /** Set when the budget filter had to be dropped to find any match. */
  budgetRelaxed: boolean
  warning: AccuracyWarning
}

function passesBudget(profile: PickProfile, budget: Budget): boolean {
  if (budget === 'cheap') return profile.costTier <= 1
  return true
}
function score(profile: PickProfile, answers: GuideAnswers): number {
  const need = QUALITY_NEED[answers.complexity]
  // Meeting the quality bar is worth full marks; being underpowered is
  // penalized twice as hard as the gap (a wrong answer costs a sale).
  const quality = profile.quality >= need ? 3 : 3 - 2 * (need - profile.quality)
  // Speed only differentiates when the user demanded instant answers.
  const speed =
    answers.patience === 'instant'
      ? profile.speed >= 3
        ? 2
        : profile.speed === 2
          ? 1
          : 0
      : 1
  // A small ever-present cost drag — even "whatever it takes" users shouldn't
  // be steered to a pricier tier when a cheaper one meets the quality need
  // (this is what keeps Opus from stealing mere comparison questions).
  const costDrag = 0.25 * profile.costTier
  return quality + speed - costDrag
}

/**
 * Pick the best recommendation for the answers. Never returns null when
 * `picks` is non-empty: if the budget constraint eliminates everything, it is
 * relaxed (and reported) rather than failing.
 */
export function recommendModel(
  answers: GuideAnswers,
  picks: RecommendedPick[],
): GuideResult | null {
  if (picks.length === 0) return null

  let budgetRelaxed = false
  let candidates = picks.filter(
    (p) =>
      (!answers.photos || p.profile.vision) &&
      passesBudget(p.profile, answers.budget),
  )
  if (candidates.length === 0) {
    budgetRelaxed = true
    candidates = picks.filter((p) => !answers.photos || p.profile.vision)
  }
  if (candidates.length === 0) {
    // Even vision can't be satisfied — recommend the best generalist.
    budgetRelaxed = answers.budget !== 'best'
    candidates = picks
  }

  const ranked = [...candidates].sort((a, b) => {
    const diff = score(b.profile, answers) - score(a.profile, answers)
    if (diff !== 0) return diff
    // Tie-break: if they'll pay for the best, prefer quality; otherwise
    // prefer the cheaper tier. Then the remaining dimension, then list order.
    if (answers.budget === 'best') {
      if (a.profile.quality !== b.profile.quality)
        return b.profile.quality - a.profile.quality
      if (a.profile.costTier !== b.profile.costTier)
        return a.profile.costTier - b.profile.costTier
    } else {
      if (a.profile.costTier !== b.profile.costTier)
        return a.profile.costTier - b.profile.costTier
      if (a.profile.quality !== b.profile.quality)
        return b.profile.quality - a.profile.quality
    }
    return picks.indexOf(a) - picks.indexOf(b)
  })

  return {
    pick: ranked[0],
    budgetRelaxed,
    warning: accuracyWarning(answers),
  }
}

/**
 * The honesty clause, now with measured teeth (IMA-43 bench): the cheap
 * default misses ~1 in 5 HARD questions where the premium picks miss ~1 in
 * 20 → 'strong' (say it loudly). On comparisons it's ~1 in 8 vs near-perfect
 * → 'mild' (a nudge). Simple lookups are fine on anything.
 */
export function accuracyWarning(answers: GuideAnswers): AccuracyWarning {
  if (answers.budget === 'cheap' && answers.complexity === 'hard')
    return 'strong'
  if (answers.budget === 'cheap' && answers.complexity === 'compare')
    return 'mild'
  return null
}
