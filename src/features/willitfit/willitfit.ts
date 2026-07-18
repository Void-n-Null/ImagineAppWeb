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

/**
 * Recover the verdict from the transcript. The compute_tv_fit TOOL RESULT is
 * ground truth (the tool emits the token deterministically), so scan tool
 * messages newest-first before trusting the assistant to have copied the
 * token into its reply. Smaller models routinely drop it.
 */
export function extractFitVerdictFromTranscript(
  transcript: ChatMessage[],
): FitVerdictSegment | null {
  const fromRole = (role: 'tool' | 'assistant'): FitVerdictSegment | null => {
    for (let index = transcript.length - 1; index >= 0; index--) {
      const message = transcript[index]
      if (message.role !== role) continue
      const segment = parseRichSegments(message.content).find(
        (candidate): candidate is FitVerdictSegment =>
          candidate.kind === 'fit-verdict',
      )
      if (segment) return segment
    }
    return null
  }
  return fromRole('tool') ?? fromRole('assistant')
}
