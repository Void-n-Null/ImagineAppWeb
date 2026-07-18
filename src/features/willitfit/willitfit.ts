import type { ChatMessage } from '#/features/agent'
import {
  parseRichSegments,
  type FitVerdictSegment,
} from '#/features/chat/rich-cards'

export type FitVerdictTier = 'fits' | 'tight' | 'no-fit'

export function fitStageCaptionForTool(toolName: string): string {
  switch (toolName) {
    case 'identify_vehicle':
      return 'SCOUTING THE ARENA'
    case 'web_search':
      return 'MEASURING THE CARGO BAY'
    case 'compute_tv_fit':
      return 'RUNNING THE NUMBERS'
    default:
      return 'CONFERRING WITH THE JUDGES'
  }
}

export function fitVerdictTier(percentAny: number): FitVerdictTier {
  if (percentAny >= 85) return 'fits'
  if (percentAny >= 15) return 'tight'
  return 'no-fit'
}

/** Read only the final assistant response, which is the turn's final ruling. */
export function extractFitVerdictFromTranscript(
  transcript: ChatMessage[],
): FitVerdictSegment | null {
  for (let index = transcript.length - 1; index >= 0; index--) {
    const message = transcript[index]
    if (message.role !== 'assistant') continue
    return (
      parseRichSegments(message.content).find(
        (segment): segment is FitVerdictSegment =>
          segment.kind === 'fit-verdict',
      ) ?? null
    )
  }
  return null
}
