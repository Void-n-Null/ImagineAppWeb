/**
 * The browser AgentHost (IMA-17). Kept out of tool.ts so the tool contract
 * stays pure data: this module reaches into the localStorage cart store and
 * the device clock, which only make sense in a browser.
 *
 * The chat page composes its host from this helper plus its own requestScan
 * (which owns the camera UI + timeout). The server host is a different
 * implementation of the same AgentHost interface (see api.agent.turn.ts);
 * both satisfy the tools identically, which is the whole Phase-2 insurance.
 */

import {
  addCartItem,
  type CartItem,
  clearCart,
  getCartItems,
  removeCartItem,
} from '#/features/cart/cart-store'
import type { AgentHost, ScanOutcome } from './tool'

/**
 * Build the browser host. `requestScan` is injected because it owns
 * client-only UI (the scanner sheet + 20s timeout) that lives in the chat
 * feature, not here.
 */
export function createClientHost(
  requestScan: (promptText: string) => Promise<ScanOutcome>,
): AgentHost {
  return {
    requestScan,
    cart: {
      items: () => getCartItems(),
      add: (item: CartItem) => {
        addCartItem(item)
      },
      remove: (sku: number) => removeCartItem(sku),
      clear: () => clearCart(),
    },
    clock: () => ({
      iso: new Date().toISOString(),
      // Resolved IANA zone of the device, e.g. "America/Chicago".
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
  }
}
