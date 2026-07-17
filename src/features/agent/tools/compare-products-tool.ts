import type { BestBuyProduct } from '#/server/bestbuy/types'
import { getProductsBatch } from '#/server/functions/get-products-batch'
import type { AgentTool } from '../tool'
import { formatPrice } from './format'

/**
 * compare_products — side-by-side facts for 2-5 SKUs (IMA-6).
 *
 * v1 shipped a whole comparison engine that pre-digested spec diffs for the
 * model. The v2 DTO carries fewer raw spec fields but modern models diff
 * well-structured facts fine on their own, so this formats aligned per-product
 * sections instead of computing differences.
 */
export const compareProductsTool: AgentTool = {
  name: 'compare_products',
  description: `Compare 2-5 products side by side by SKU. Returns aligned facts for each: price, rating, availability, key features.
Use when the user is deciding between specific products. Get SKUs from search_products or analyze_product first.`,
  parameters: {
    type: 'object',
    properties: {
      skus: {
        type: 'array',
        items: { type: 'integer' },
        minItems: 2,
        maxItems: 5,
        description: 'Best Buy SKU numbers of the products to compare.',
      },
    },
    required: ['skus'],
  },
  statusLabel(args) {
    const count = Array.isArray(args.skus) ? args.skus.length : 0
    return count > 0 ? `Comparing ${count} products` : 'Comparing products'
  },
  async execute(args) {
    const skus = Array.isArray(args.skus)
      ? args.skus.filter(
          (s): s is number =>
            typeof s === 'number' && Number.isSafeInteger(s) && s > 0,
        )
      : []
    if (skus.length < 2) {
      return 'Error: provide at least 2 valid SKUs to compare (max 5).'
    }

    const result = await getProductsBatch({ data: { skus: skus.slice(0, 5) } })
    if (result.status === 'error') {
      return `Comparison failed: ${result.message}`
    }
    if (result.products.length < 2) {
      return `Could not find enough products to compare.${
        result.missingSkus.length > 0
          ? ` Not found: ${result.missingSkus.join(', ')}.`
          : ''
      } Verify the SKUs via search_products.`
    }

    const lines: string[] = ['# Comparison', '']
    if (result.missingSkus.length > 0) {
      lines.push(`Note: not found: ${result.missingSkus.join(', ')}`, '')
    }
    result.products.forEach((product, i) => {
      lines.push(...productSection(i + 1, product), '')
    })
    lines.push(
      `Show this side by side with [Compare(${result.products
        .map((p) => p.sku)
        .join(',')})] on its own line, alongside your text summary.`,
    )
    return lines.join('\n')
  },
}

function productSection(index: number, p: BestBuyProduct): string[] {
  const lines = [`## ${index}. ${p.name}`]
  const facts: string[] = [`SKU ${p.sku}`]
  if (p.modelNumber) facts.push(`Model ${p.modelNumber}`)
  if (p.manufacturer) facts.push(p.manufacturer)
  lines.push(`- ${facts.join(' | ')}`)

  const current = p.salePrice ?? p.regularPrice
  lines.push(
    `- Price: ${formatPrice(current)}${
      p.onSale && p.regularPrice !== null
        ? ` (on sale, was ${formatPrice(p.regularPrice)})`
        : ''
    }`,
  )
  if (p.customerReviewAverage !== null) {
    lines.push(
      `- Rating: ${p.customerReviewAverage.toFixed(1)}/5 (${p.customerReviewCount ?? 0} reviews)`,
    )
  }
  const online = p.onlineAvailability === true
  const chain = p.inStoreAvailability === true
  lines.push(
    `- Availability: ${
      online && chain
        ? 'sold in stores + online'
        : chain
          ? 'sold in stores'
          : online
            ? 'online only'
            : 'unavailable'
    }`,
  )
  if (p.color) lines.push(`- Color: ${p.color}`)
  if (p.releaseDate) lines.push(`- Released: ${p.releaseDate}`)
  if (p.features.length > 0) {
    lines.push('- Key features:')
    for (const feature of p.features.slice(0, 8)) {
      lines.push(`  - ${feature}`)
    }
  }
  return lines
}
