import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '#/features/agent'
import {
  extractFitVerdictFromTranscript,
  fitStageCaptionForTool,
  fitVerdictTier,
} from './willitfit'

function assistant(content: string): ChatMessage {
  return { id: 'assistant', role: 'assistant', content, at: 1 }
}

describe('fitStageCaptionForTool', () => {
  it('maps fit tools to the game-show stages', () => {
    expect(fitStageCaptionForTool('identify_vehicle')).toBe(
      'SCOUTING THE ARENA',
    )
    expect(fitStageCaptionForTool('web_search')).toBe('MEASURING THE CARGO BAY')
    expect(fitStageCaptionForTool('compute_tv_fit')).toBe('RUNNING THE NUMBERS')
    expect(fitStageCaptionForTool('analyze_product')).toBe(
      'CONFERRING WITH THE JUDGES',
    )
  })
})

describe('fitVerdictTier', () => {
  it('uses the specified tier boundaries', () => {
    expect(fitVerdictTier(85)).toBe('fits')
    expect(fitVerdictTier(84)).toBe('tight')
    expect(fitVerdictTier(15)).toBe('tight')
    expect(fitVerdictTier(14)).toBe('no-fit')
  })
})

describe('extractFitVerdictFromTranscript', () => {
  it('returns the FitVerdict percent from the final assistant response', () => {
    const transcript: ChatMessage[] = [
      { id: 'user', role: 'user', content: 'Will it fit?', at: 0 },
      assistant('Checking measurements first.'),
      assistant(
        'The box should clear the opening. [FitVerdict(8041012,87,tilted,2019%20Honda%20CR-V,1,38,9,42,31)]',
      ),
    ]

    expect(extractFitVerdictFromTranscript(transcript)?.percentAny).toBe(87)
  })

  it('returns null when the final assistant response has no FitVerdict token', () => {
    const transcript: ChatMessage[] = [
      assistant(
        '[FitVerdict(8041012,87,tilted,2019%20Honda%20CR-V,1,38,9,42,31)]',
      ),
      assistant('I could not find reliable cargo dimensions. Please measure.'),
    ]

    expect(extractFitVerdictFromTranscript(transcript)).toBeNull()
  })
})
