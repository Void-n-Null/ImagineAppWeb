import { cartItemFromProduct } from '#/features/cart/cart-store'
import { getProductDetail } from '#/server/functions/get-product-detail'
import type { AgentTool } from '../tool'
import { formatPrice } from './format'

/**
 * Cart CRUD tools (IMA-6). These go through host.cart (IMA-17) rather than
 * the cart-store functions directly: the client host reads/writes
 * localStorage, the server host mutates the per-turn snapshot and streams the
 * mutation back to the client. Only cartItemFromProduct (a pure mapper) is
 * imported from the store. The "cart" is the floor working list — items an
 * employee/customer is gathering during a conversation.
 */

export const addToCartTool: AgentTool = {
  name: 'add_to_cart',
  description:
    "Add a product to the user's cart (a saved working list on this device). Requires the SKU. Use when the user wants to save/queue a product.",
  parameters: {
    type: 'object',
    properties: {
      sku: { type: 'integer', description: 'Best Buy SKU to add.' },
    },
    required: ['sku'],
  },
  statusLabel() {
    return 'Adding to cart'
  },
  async execute(args, host) {
    const sku =
      typeof args.sku === 'number' && Number.isSafeInteger(args.sku)
        ? args.sku
        : undefined
    if (sku === undefined) return 'Error: sku is required (integer).'

    const existing = host.cart.items().find((item) => item.sku === sku)
    if (existing) {
      return `"${existing.name}" is already in the cart (${host.cart.items().length} items total).`
    }

    const result = await getProductDetail({ data: { sku } })
    if (result.status === 'error')
      return `Could not add SKU ${sku}: ${result.message}`
    if (result.status === 'not_found')
      return `No product found for SKU ${sku} — verify the number.`

    host.cart.add(cartItemFromProduct(result.product))
    const count = host.cart.items().length
    return `Added "${result.product.name}" (${formatPrice(result.product.salePrice ?? result.product.regularPrice)}) to the cart. Cart now has ${count} item${count === 1 ? '' : 's'}.`
  },
}

export const removeFromCartTool: AgentTool = {
  name: 'remove_from_cart',
  description:
    "Remove a product from the user's cart by SKU. Use view_cart first if you don't know the SKU.",
  parameters: {
    type: 'object',
    properties: {
      sku: { type: 'integer', description: 'Best Buy SKU to remove.' },
    },
    required: ['sku'],
  },
  statusLabel() {
    return 'Updating cart'
  },
  async execute(args, host) {
    const sku =
      typeof args.sku === 'number' && Number.isSafeInteger(args.sku)
        ? args.sku
        : undefined
    if (sku === undefined) return 'Error: sku is required (integer).'

    const removed = host.cart.remove(sku)
    if (!removed) return `SKU ${sku} is not in the cart.`
    const count = host.cart.items().length
    return `Removed "${removed.name}". Cart now has ${count} item${count === 1 ? '' : 's'}.`
  },
}

export const viewCartTool: AgentTool = {
  name: 'view_cart',
  description:
    "List everything in the user's cart with SKUs, prices, and the estimated total.",
  parameters: { type: 'object', properties: {}, required: [] },
  statusLabel() {
    return 'Checking cart'
  },
  async execute(_args, host) {
    const items = host.cart.items()
    if (items.length === 0) {
      return 'The cart is empty. Use add_to_cart to save products.'
    }
    const lines = [
      `Cart has ${items.length} item${items.length === 1 ? '' : 's'}:`,
      '',
    ]
    let total = 0
    let priced = 0
    items.forEach((item, i) => {
      const parts: string[] = [`SKU ${item.sku}`]
      if (item.manufacturer) parts.push(item.manufacturer)
      if (item.price !== null) {
        parts.push(formatPrice(item.price))
        total += item.price
        priced += 1
      }
      lines.push(`${i + 1}. ${item.name}`, `   ${parts.join(' | ')}`)
    })
    if (priced > 0) {
      lines.push(
        '',
        `Estimated total: ${formatPrice(total)}${priced < items.length ? ' (some items unpriced)' : ''}`,
      )
    }
    lines.push(
      '',
      'When showing cart items to the user, use [Product(SKU)] cards.',
    )
    return lines.join('\n')
  },
}

export const clearCartTool: AgentTool = {
  name: 'clear_cart',
  description:
    "Remove ALL items from the user's cart. Cannot be undone — confirm with the user first.",
  parameters: { type: 'object', properties: {}, required: [] },
  statusLabel() {
    return 'Clearing cart'
  },
  async execute(_args, host) {
    const count = host.cart.clear()
    return count === 0
      ? 'The cart was already empty.'
      : `Cleared ${count} item${count === 1 ? '' : 's'}. The cart is now empty.`
  },
}
