// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  addCartItem,
  type CartItem,
  clearCart,
  getCartItems,
  removeCartItem,
} from './cart-store'

function item(sku: number, name = `Item ${sku}`): CartItem {
  return {
    sku,
    name,
    price: 9.99,
    manufacturer: null,
    modelNumber: null,
    upc: null,
    image: null,
    addedAt: 0,
  }
}

describe('cart store', () => {
  beforeEach(() => {
    localStorage.clear()
    clearCart()
  })

  it('adds items and is idempotent by SKU', () => {
    expect(addCartItem(item(1))).toBe(true)
    expect(addCartItem(item(1))).toBe(false)
    expect(getCartItems()).toHaveLength(1)
  })

  it('removes by SKU and reports the removed item', () => {
    addCartItem(item(1, 'Cable'))
    expect(removeCartItem(1)?.name).toBe('Cable')
    expect(removeCartItem(1)).toBeNull()
    expect(getCartItems()).toHaveLength(0)
  })

  it('clears and reports the count', () => {
    addCartItem(item(1))
    addCartItem(item(2))
    expect(clearCart()).toBe(2)
    expect(getCartItems()).toEqual([])
  })

  it('survives corrupt storage', () => {
    localStorage.setItem('imagine:cart', '{not json')
    expect(getCartItems()).toEqual([])
  })
})
