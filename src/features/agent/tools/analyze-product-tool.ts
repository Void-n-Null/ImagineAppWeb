import { getProductDetail } from '#/server/functions/get-product-detail'
import type { AgentTool } from '../tool'
import { formatProductContext } from './format'

/** analyze_product — full product detail by SKU or UPC (IMA-6). */
export const analyzeProductTool: AgentTool = {
  name: 'analyze_product',
  description: `Get comprehensive details about one product: pricing, availability, reviews, description, features, what's in the box.
Provide either a SKU (Best Buy's numeric id, printed on shelf tags) or a UPC (the barcode digits).
Use this before answering specific questions about a product.`,
  parameters: {
    type: 'object',
    properties: {
      sku: {
        type: 'integer',
        description: 'Best Buy SKU number (from search results or shelf tag).',
      },
      upc: {
        type: 'string',
        description: 'UPC barcode digits (usually 12-13 digits).',
      },
    },
    required: [],
  },
  statusLabel(args) {
    if (typeof args.sku === 'number') return `Analyzing SKU ${args.sku}`
    return 'Analyzing product'
  },
  async execute(args) {
    const sku =
      typeof args.sku === 'number' && Number.isSafeInteger(args.sku)
        ? args.sku
        : undefined
    const upcRaw =
      typeof args.upc === 'string' || typeof args.upc === 'number'
        ? String(args.upc).trim()
        : undefined
    const upc = upcRaw && /^\d{6,14}$/.test(upcRaw) ? upcRaw : undefined

    if (sku === undefined && upc === undefined) {
      return 'Error: provide a SKU (integer) or UPC (barcode digits) to look up.'
    }

    const result = await getProductDetail({
      data: sku !== undefined ? { sku } : { upc },
    })
    switch (result.status) {
      case 'found':
        return `${formatProductContext(result.product)}\n\nShow this product to the user as a card: [Product(${result.product.sku})] on its own line.`
      case 'not_found':
        return `No product found for ${sku !== undefined ? `SKU ${sku}` : `UPC ${upc}`}. Verify the number, or search by name instead.`
      case 'error':
        return `Lookup failed: ${result.message}`
    }
  },
}
