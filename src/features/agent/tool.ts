/**
 * Tool contract for the agent loop (IMA-6).
 *
 * ARCHITECTURAL CONSTRAINT (the Phase-2 insurance): tools are pure
 * `(args, host) => Promise<string>` with JSON-schema definitions. No React,
 * no DOM. Anything inherently client-side (the camera) is modeled as a
 * capability on {@link AgentHost} that the tool REQUESTS from its host — a
 * future server-side loop implements the same interface by pausing and
 * round-tripping to the client instead of opening a camera itself.
 */

import type { CartItem } from '#/features/cart/cart-store'
import type { BestBuyProduct } from '#/server/bestbuy/types'

/** Outcome of a host-mediated barcode scan (request_scan). */
export type ScanOutcome =
  | { status: 'scanned'; product: BestBuyProduct }
  | { status: 'not-found'; code: string }
  | { status: 'cancelled' }
  | { status: 'timeout' }
  | { status: 'error'; message: string }

/**
 * Capabilities the loop's host environment provides to tools (IMA-6, IMA-17).
 *
 * Tools stay pure `(args, host) => Promise<string>`; anything that differs
 * between the browser loop and the server loop lives HERE, behind an
 * identical interface. Phase 2 (IMA-17) moves the loop to the server: the
 * server host mutates a per-turn cart snapshot (and streams the mutations to
 * the client), carries the clock values the client sent in the turn request,
 * and never opens a camera — request_scan is intercepted in the runner and
 * handed back to the client as a client_action.
 */
export interface AgentHost {
  /**
   * Ask the human to scan a barcode. Resolves when the scan completes,
   * is cancelled, or times out (host enforces the timeout).
   *
   * On the server loop this is never invoked — request_scan is a
   * client-action tool the runner intercepts (see agent-runner
   * clientActionTools). A server host implements it defensively as a throw.
   */
  requestScan(promptText: string): Promise<ScanOutcome>
  /**
   * The user's cart (their saved working list). The client host reads/writes
   * localStorage; the server host operates on the per-turn snapshot the
   * client sent and emits {type:'cart'} events so the client can apply the
   * same mutation to its store.
   */
  cart: {
    items(): CartItem[]
    /** Add by value. Idempotent by SKU is the caller's concern. */
    add(item: CartItem): void
    /** Remove by SKU. Returns the removed item, or null when absent. */
    remove(sku: number): CartItem | null
    /** Empty the cart. Returns how many items were removed. */
    clear(): number
  }
  /**
   * The client's wall clock: an ISO timestamp plus its IANA timezone. The
   * client host reads the device; the server host carries the values the
   * client sent in the turn request (the server's own clock is UTC in a
   * datacenter and useless for "what time is it here?").
   */
  clock(): { iso: string; timeZone: string }
}

/** JSON Schema (subset) for tool parameters. */
export type JsonSchema = Record<string, unknown>

export interface AgentTool {
  /** Snake_case identifier used in function calls. */
  name: string
  /** What the model reads to decide when to call this tool. */
  description: string
  /** JSON Schema for the arguments object. */
  parameters: JsonSchema
  /**
   * Short present-progressive label shown in the UI while running,
   * e.g. "Searching products". May inspect args for specificity.
   */
  statusLabel(args: Record<string, unknown>): string
  /** Execute and return the string the model sees. Must not throw. */
  execute(args: Record<string, unknown>, host: AgentHost): Promise<string>
}

/** OpenAI-compatible function schema for the tools array. */
export function toToolSchema(tool: AgentTool): Record<string, unknown> {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }
}
