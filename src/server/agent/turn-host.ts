/**
 * The server-side AgentHost (IMA-17 Phase 2). Split out of the route so it's
 * unit-testable without dragging in Redis/Clerk: it's pure data + an emit
 * callback.
 *
 * It operates on a mutable COPY of the request's cart snapshot; every mutation
 * also emits the matching {type:'cart'} TurnEvent so the client can apply the
 * same change to its localStorage store. request_scan is never invoked here —
 * the runner intercepts it as a client-action (clientActionTools) — so it
 * throws defensively.
 */

import type { AgentHost, TurnEvent } from '#/features/agent'
import type { CartItem } from '#/features/cart/cart-store'

export function createServerHost(
  initialCart: CartItem[],
  clock: { iso: string; timeZone: string },
  emit: (event: TurnEvent) => void,
): AgentHost {
  const items = [...initialCart]
  return {
    requestScan() {
      // Unreachable on the server: the runner hands request_scan back to the
      // client before it can reach tool.execute. Throw if that ever changes.
      throw new Error('request_scan must be client-dispatched')
    },
    cart: {
      items: () => items,
      add: (item: CartItem) => {
        // Idempotent by SKU, matching the client cart store.
        if (items.some((existing) => existing.sku === item.sku)) return
        items.push(item)
        emit({ type: 'cart', op: 'add', item })
      },
      remove: (sku: number) => {
        const index = items.findIndex((item) => item.sku === sku)
        if (index === -1) return null
        const [removed] = items.splice(index, 1)
        emit({ type: 'cart', op: 'remove', sku })
        return removed ?? null
      },
      clear: () => {
        const count = items.length
        if (count > 0) {
          items.length = 0
          emit({ type: 'cart', op: 'clear' })
        }
        return count
      },
    },
    clock: () => clock,
  }
}
