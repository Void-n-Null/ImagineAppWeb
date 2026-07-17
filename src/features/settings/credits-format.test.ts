import { describe, expect, it } from 'vitest'
import { estimateQuestions, questionsCaption } from './credits-format'

// flash-lite catalog pricing ($/1M), the anchor model.
const FLASH_LITE = { input: 0.25, output: 1.5 }
// A model priced 10x flash-lite on both dimensions.
const TEN_X = { input: 2.5, output: 15 }

describe('estimateQuestions', () => {
  it('lands ~183 for flash-lite at 100 credits (measured-anchor math)', () => {
    const n = estimateQuestions(100, FLASH_LITE)
    expect(n).not.toBeNull()
    // Assert a band, not the exact integer — the constants are the contract.
    expect(n).toBeGreaterThanOrEqual(170)
    expect(n).toBeLessThanOrEqual(195)
  })

  it('scales down ~10x for a 10x-pricier model', () => {
    const n = estimateQuestions(100, TEN_X)
    expect(n).not.toBeNull()
    expect(n).toBeGreaterThanOrEqual(15)
    expect(n).toBeLessThanOrEqual(21)
  })

  it('returns null when pricing is unavailable', () => {
    expect(estimateQuestions(100, undefined)).toBeNull()
    expect(estimateQuestions(100, { input: null, output: null })).toBeNull()
    expect(
      estimateQuestions(100, { input: 0.25, output: undefined }),
    ).toBeNull()
  })

  it('returns 0 for non-positive credits', () => {
    expect(estimateQuestions(0, FLASH_LITE)).toBe(0)
    expect(estimateQuestions(-5, FLASH_LITE)).toBe(0)
  })
})

describe('questionsCaption', () => {
  it('is model-aware with pricing + name', () => {
    const n = estimateQuestions(100, FLASH_LITE)
    expect(questionsCaption(100, FLASH_LITE, 'Gemini 3.1 Flash Lite')).toBe(
      `about ${n} questions on Gemini 3.1 Flash Lite`,
    )
  })

  it('uses the singular for exactly one estimated question', () => {
    // Price the model so 1 credit ≈ 1 question, then check pluralization.
    const one = estimateQuestions(1, FLASH_LITE)
    expect(one).toBe(1)
    expect(questionsCaption(1, FLASH_LITE, 'Flash Lite')).toBe(
      'about 1 question on Flash Lite',
    )
  })

  it('falls back to flat wording without model pricing', () => {
    expect(questionsCaption(100)).toBe('roughly 100 questions')
    expect(questionsCaption(2, { input: null, output: null }, 'X')).toBe(
      'roughly 2 questions',
    )
  })

  it('falls back to flat wording without a model name', () => {
    expect(questionsCaption(100, FLASH_LITE)).toBe('roughly 100 questions')
  })

  it('uses the singular for exactly one in the flat fallback', () => {
    expect(questionsCaption(1)).toBe('roughly 1 question')
  })

  it('says "no questions left" at zero or below', () => {
    expect(questionsCaption(0)).toBe('no questions left')
    expect(questionsCaption(-5)).toBe('no questions left')
    expect(questionsCaption(0, FLASH_LITE, 'Flash Lite')).toBe(
      'no questions left',
    )
  })

  it('floors fractional credits in the flat fallback', () => {
    expect(questionsCaption(3.9)).toBe('roughly 3 questions')
  })
})
