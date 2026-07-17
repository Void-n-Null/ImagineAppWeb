/**
 * Shared tool-result formatting (IMA-6). Token-lean plaintext/markdown the
 * model reads — richness lives in the data, not prose. Product-bearing
 * results end with a one-line render-syntax reminder (IMA-7): point-of-use
 * nudges beat prompt-only instructions for card compliance.
 */

import type { BestBuyProduct } from '#/server/bestbuy/types'

export function formatPrice(price: number | null): string {
  if (price === null) return 'no price'
  return price % 1 === 0 ? `$${price.toFixed(0)}` : `$${price.toFixed(2)}`
}

function priceLine(product: BestBuyProduct): string {
  const current = product.salePrice ?? product.regularPrice
  if (current === null) return 'no price'
  if (product.onSale && product.regularPrice !== null) {
    const pct =
      product.percentSavings !== null
        ? ` -${product.percentSavings.toFixed(0)}%`
        : ''
    return `${formatPrice(current)} (was ${formatPrice(product.regularPrice)}${pct})`
  }
  return formatPrice(current)
}

function availabilityLabel(product: BestBuyProduct): string {
  const online = product.onlineAvailability === true
  const chainStore = product.inStoreAvailability === true
  if (online && chainStore) return 'sold in stores + online'
  if (chainStore) return 'sold in stores'
  if (online) return 'online only'
  return 'unavailable'
}

/** Compact two-line row for search results. */
export function formatProductRow(
  index: number,
  product: BestBuyProduct,
): string {
  const details: string[] = [priceLine(product)]
  if (product.manufacturer) details.push(product.manufacturer)
  if (product.customerReviewAverage !== null) {
    const count =
      product.customerReviewCount !== null
        ? ` (${product.customerReviewCount} reviews)`
        : ''
    details.push(`${product.customerReviewAverage.toFixed(1)}/5${count}`)
  }
  details.push(availabilityLabel(product))
  const model = product.modelNumber ? ` | Model ${product.modelNumber}` : ''
  return `${index}. ${product.name} (SKU ${product.sku}${model})\n   ${details.join(' | ')}`
}

/**
 * Full product context — used for analyze_product results, scanned products,
 * and user attachments. Availability wording keeps the chain-wide caveat
 * (IMA-DOC-5): "sold in stores" is a catalog flag, not YOUR store's stock.
 */
export function formatProductContext(product: BestBuyProduct): string {
  const lines: string[] = [`# ${product.name}`]

  lines.push('', '## Identifiers', `- SKU: ${product.sku}`)
  if (product.upc) lines.push(`- UPC: ${product.upc}`)
  if (product.modelNumber) lines.push(`- Model: ${product.modelNumber}`)
  if (product.manufacturer) lines.push(`- Brand: ${product.manufacturer}`)
  if (product.color) lines.push(`- Color: ${product.color}`)
  if (product.condition) lines.push(`- Condition: ${product.condition}`)

  lines.push('', '## Pricing')
  if (product.onSale && product.salePrice !== null) {
    lines.push(`- Current price: ${formatPrice(product.salePrice)} (ON SALE)`)
    if (product.regularPrice !== null)
      lines.push(`- Regular price: ${formatPrice(product.regularPrice)}`)
    if (product.dollarSavings !== null)
      lines.push(
        `- Savings: ${formatPrice(product.dollarSavings)}${
          product.percentSavings !== null
            ? ` (${product.percentSavings.toFixed(0)}% off)`
            : ''
        }`,
      )
  } else {
    lines.push(
      `- Price: ${formatPrice(product.salePrice ?? product.regularPrice)}`,
    )
  }

  lines.push('', '## Availability')
  lines.push(
    `- Online: ${product.onlineAvailability === true ? 'available' : 'not available'}${
      product.onlineAvailabilityText
        ? ` (${product.onlineAvailabilityText})`
        : ''
    }`,
  )
  lines.push(
    `- Stores: ${
      product.inStoreAvailability === true
        ? 'sold in Best Buy stores (chain-wide flag — NOT a stock check for any specific store)'
        : 'not sold in stores'
    }`,
  )
  if (product.freeShipping === true) lines.push('- Shipping: free')
  else if (product.shippingCost !== null)
    lines.push(`- Shipping: ${formatPrice(product.shippingCost)}`)
  if (product.releaseDate) lines.push(`- Released: ${product.releaseDate}`)

  if (product.customerReviewAverage !== null) {
    lines.push(
      '',
      '## Reviews',
      `- ${product.customerReviewAverage.toFixed(1)}/5 from ${product.customerReviewCount ?? 0} reviews`,
    )
  }

  const description = product.shortDescription ?? product.longDescription
  if (description) {
    const trimmed =
      description.length > 600 ? `${description.slice(0, 600)}…` : description
    lines.push('', '## Description', trimmed)
  }

  if (product.features.length > 0) {
    lines.push('', '## Key features')
    for (const feature of product.features.slice(0, 10)) {
      lines.push(`- ${feature}`)
    }
    if (product.features.length > 10)
      lines.push(`- …and ${product.features.length - 10} more`)
  }

  if (product.includedItemList.length > 0) {
    lines.push('', "## What's in the box")
    for (const item of product.includedItemList) lines.push(`- ${item}`)
  }

  if (product.categoryPath.length > 0) {
    lines.push(
      '',
      '## Category',
      product.categoryPath.map((c) => c.name).join(' > '),
    )
  }

  if (product.stale === true) {
    lines.push(
      '',
      'NOTE: served from a slightly stale cache — prices may have rolled over today.',
    )
  }

  return lines.join('\n')
}

/** Short context block for a user-attached product. */
export function formatAttachmentContext(product: BestBuyProduct): string {
  return `[Attached product]\n${formatProductContext(product)}`
}
