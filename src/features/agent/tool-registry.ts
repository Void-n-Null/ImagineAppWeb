/**
 * Plain tool registry (IMA-6). Deliberately boring: a Map with lookup and
 * schema export. The registry is constructed per conversation-send so tests
 * and the future server loop can assemble their own tool sets.
 */

import { type AgentTool, toToolSchema } from './tool'

export class ToolRegistry {
  private readonly tools = new Map<string, AgentTool>()

  constructor(tools: AgentTool[] = []) {
    for (const tool of tools) this.register(tool)
  }

  register(tool: AgentTool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`)
    }
    this.tools.set(tool.name, tool)
  }

  get(name: string): AgentTool | undefined {
    return this.tools.get(name)
  }

  get size(): number {
    return this.tools.size
  }

  /** OpenAI-compatible `tools` array for the completion request. */
  get schemas(): Record<string, unknown>[] {
    return [...this.tools.values()].map(toToolSchema)
  }
}
