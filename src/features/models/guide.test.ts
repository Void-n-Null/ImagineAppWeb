import { describe, expect, it } from 'vitest'
import { accuracyWarning, type GuideAnswers, recommendModel } from './guide'
import { RECOMMENDED_PICKS } from './recommended'

function answers(overrides: Partial<GuideAnswers> = {}): GuideAnswers {
  return {
    complexity: 'compare',
    photos: false,
    patience: 'patient',
    budget: 'best',
    ...overrides,
  }
}

describe('recommendModel (against the live pick set)', () => {
  it('hard questions + willing to pay → the benchmark leader (Sonnet 5)', () => {
    const r = recommendModel(
      answers({ complexity: 'hard', budget: 'best', patience: 'patient' }),
      RECOMMENDED_PICKS,
    )
    expect(r?.pick.id).toBe('anthropic/claude-sonnet-5')
    expect(r?.warning).toBeNull()
  })

  it('comparisons + best answer → the step-up (same measured compare score as Sonnet, cheaper)', () => {
    const r = recommendModel(
      answers({ complexity: 'compare', budget: 'best' }),
      RECOMMENDED_PICKS,
    )
    expect(r?.pick.id).toBe('google/gemini-3-flash-preview')
  })

  it('simple questions → the measured-cheap default, instant or patient', () => {
    for (const patience of ['instant', 'patient'] as const) {
      const r = recommendModel(
        answers({ complexity: 'simple', patience, budget: 'cheap' }),
        RECOMMENDED_PICKS,
      )
      expect(r?.pick.id).toBe('google/gemini-3.1-flash-lite')
    }
  })

  it('hard + cheap → still the default (only cheap pick), with the strong honesty warning', () => {
    const r = recommendModel(
      answers({ complexity: 'hard', budget: 'cheap' }),
      RECOMMENDED_PICKS,
    )
    expect(r?.pick.id).toBe('google/gemini-3.1-flash-lite')
    expect(r?.budgetRelaxed).toBe(false)
    expect(r?.warning).toBe('strong')
  })

  it('photos never eliminate the roster (every surviving pick has vision)', () => {
    const r = recommendModel(answers({ photos: true }), RECOMMENDED_PICKS)
    expect(r?.pick.profile.vision).toBe(true)
    expect(r?.budgetRelaxed).toBe(false)
  })

  it('relaxes the budget rather than returning nothing', () => {
    // A pick set with no cheap-tier option at all.
    const picks = RECOMMENDED_PICKS.filter((p) => p.profile.costTier > 1)
    const r = recommendModel(answers({ budget: 'cheap' }), picks)
    expect(r).not.toBeNull()
    expect(r?.budgetRelaxed).toBe(true)
  })

  it('returns null only for an empty pick set', () => {
    expect(recommendModel(answers(), [])).toBeNull()
  })
})

describe('accuracyWarning (the honesty clause, measured)', () => {
  it('cheap + hard → strong warning (~1 in 5 misses vs ~1 in 20)', () => {
    expect(
      accuracyWarning(answers({ budget: 'cheap', complexity: 'hard' })),
    ).toBe('strong')
  })

  it('cheap + comparisons → mild warning (~1 in 8 misses)', () => {
    expect(
      accuracyWarning(answers({ budget: 'cheap', complexity: 'compare' })),
    ).toBe('mild')
  })

  it('no warning when the budget fits the ambition', () => {
    expect(
      accuracyWarning(answers({ budget: 'cheap', complexity: 'simple' })),
    ).toBeNull()
    expect(
      accuracyWarning(answers({ budget: 'best', complexity: 'hard' })),
    ).toBeNull()
    expect(
      accuracyWarning(answers({ budget: 'best', complexity: 'compare' })),
    ).toBeNull()
  })
})
