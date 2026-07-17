/**
 * AgentHost for benchmark runs: in-memory cart, fixed local clock, no
 * scanning (request_scan is intercepted as a client action by the runner, so
 * reaching requestScan() here is a bug — same defensive throw as the server
 * host).
 */

import type { AgentHost } from '#/features/agent'
import type { CartItem } from '#/features/cart/cart-store'

export function createBenchHost(): AgentHost {
  const items: CartItem[] = []
  return {
    requestScan() {
      throw new Error('request_scan is not available in the benchmark')
    },
    cart: {
      items: () => items,
      add: (item: CartItem) => {
        if (items.some((existing) => existing.sku === item.sku)) return
        items.push(item)
      },
      remove: (sku: number) => {
        const index = items.findIndex((item) => item.sku === sku)
        if (index === -1) return null
        const [removed] = items.splice(index, 1)
        return removed ?? null
      },
      clear: () => {
        const count = items.length
        items.length = 0
        return count
      },
    },
    clock: () => ({
      iso: new Date().toISOString(),
      timeZone: 'America/Chicago',
    }),
  }
}
