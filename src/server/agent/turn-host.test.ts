import { describe, expect, it } from 'vitest'
import type { TurnEvent } from '#/features/agent'
import type { CartItem } from '#/features/cart/cart-store'
import { createServerHost } from './turn-host'

function item(sku: number, name = `p${sku}`): CartItem {
  return {
    sku,
    name,
    price: 10,
    manufacturer: null,
    modelNumber: null,
    upc: null,
    image: null,
    addedAt: 0,
  }
}

const clock = { iso: '2026-07-07T12:00:00.000Z', timeZone: 'UTC' }

function setup(initial: CartItem[] = []) {
  const events: TurnEvent[] = []
  const host = createServerHost(initial, clock, (e) => events.push(e))
  return { host, events }
}

describe('createServerHost cart', () => {
  it('does not mutate the caller-supplied snapshot array', () => {
    const snapshot = [item(1)]
    const { host } = setup(snapshot)
    host.cart.add(item(2))
    expect(snapshot).toHaveLength(1) // operated on a copy
    expect(host.cart.items()).toHaveLength(2)
  })

  it('add emits a cart add event and is idempotent by SKU', () => {
    const { host, events } = setup()
    host.cart.add(item(1))
    host.cart.add(item(1)) // duplicate — no-op, no event
    expect(host.cart.items().map((i) => i.sku)).toEqual([1])
    expect(events).toEqual([{ type: 'cart', op: 'add', item: item(1) }])
  })

  it('remove emits a cart remove event and returns the removed item', () => {
    const { host, events } = setup([item(1), item(2)])
    const removed = host.cart.remove(1)
    expect(removed?.sku).toBe(1)
    expect(host.cart.items().map((i) => i.sku)).toEqual([2])
    expect(events).toEqual([{ type: 'cart', op: 'remove', sku: 1 }])
  })

  it('remove of an absent SKU is a silent no-op (no event)', () => {
    const { host, events } = setup([item(1)])
    expect(host.cart.remove(999)).toBeNull()
    expect(events).toEqual([])
  })

  it('clear emits once and returns the removed count', () => {
    const { host, events } = setup([item(1), item(2)])
    expect(host.cart.clear()).toBe(2)
    expect(host.cart.items()).toEqual([])
    expect(events).toEqual([{ type: 'cart', op: 'clear' }])
  })

  it('clear on an empty cart emits nothing', () => {
    const { host, events } = setup()
    expect(host.cart.clear()).toBe(0)
    expect(events).toEqual([])
  })
})

describe('createServerHost clock + requestScan', () => {
  it('returns the request clock verbatim', () => {
    const { host } = setup()
    expect(host.clock()).toEqual(clock)
  })

  it('throws for requestScan — it must be client-dispatched', () => {
    const { host } = setup()
    // Synchronous throw (defensive guard) — the runner intercepts request_scan
    // before it can reach the host, so this path is unreachable in practice.
    expect(() => host.requestScan('the cable')).toThrow(/client-dispatched/)
  })
})
