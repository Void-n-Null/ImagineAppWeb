// Agent loop + tool registry (IMA-6). The core (runner/tools/types) is
// relocation-ready: pure data + fetch, no React. UI lives in features/chat.

export {
  DEFAULT_MAX_ITERATIONS,
  type RunAgentOptions,
  runAgent,
} from './agent-runner'
export { createClientHost } from './client-host'
export {
  type CompletionResult,
  OpenRouterRequestError,
  streamCompletion,
} from './openrouter'
export { parseSseLine, readTurnEventStream } from './sse-stream'
export { SYSTEM_PROMPT } from './system-prompt'
export type { AgentHost, AgentTool, JsonSchema, ScanOutcome } from './tool'
export { toToolSchema } from './tool'
export { ToolRegistry } from './tool-registry'
export { buildDefaultToolRegistry, requestScanTool } from './tools'
export type { TurnEvent, TurnRequestBody } from './turn-protocol'
export { validateTurnRequest } from './turn-protocol'
export type {
  AgentEvent,
  AssistantMessage,
  ChatMessage,
  ImageAttachment,
  ProductAttachment,
  ReasoningDetail,
  ToolCallRequest,
  ToolResultMessage,
  UserMessage,
} from './types'
export {
  generateMessageId,
  toApiMessage,
  toApiMessages,
  userMessage,
} from './types'
