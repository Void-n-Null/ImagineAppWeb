import type { AgentTool } from '../tool'
import { formatProductContext } from './format'

/**
 * request_scan — human-in-the-loop barcode scan (IMA-6).
 *
 * Inherently client-side: the tool asks its HOST for the scan rather than
 * touching a camera itself, so a future server-side loop can implement the
 * same capability by pausing and round-tripping to the client. The host owns
 * the 20s interaction timeout.
 */
export const requestScanTool: AgentTool = {
  name: 'request_scan',
  description: `Ask the user to scan a product barcode with their camera. The app opens the scanner and waits (about 20 seconds).
Use when the user is physically holding or standing near a product and you need to identify it — e.g. "what is this?", compatibility questions, or a price check without a SKU.
Returns full product details on success, or an explanation if the scan was cancelled, timed out, or the product isn't in the catalog.`,
  parameters: {
    type: 'object',
    properties: {
      product_name: {
        type: 'string',
        description:
          'Short description of what to scan, shown to the user. E.g. "the USB cable", "the laptop\'s shelf tag".',
      },
    },
    required: ['product_name'],
  },
  statusLabel() {
    return 'Waiting for scan'
  },
  async execute(args, host) {
    const promptText =
      typeof args.product_name === 'string' && args.product_name.length > 0
        ? args.product_name
        : 'the product'

    const outcome = await host.requestScan(promptText)
    switch (outcome.status) {
      case 'scanned':
        return `=== SCANNED PRODUCT ===\n\n${formatProductContext(outcome.product)}`
      case 'not-found':
        return `The barcode scanned (${outcome.code}) but no matching product exists in the Best Buy catalog. It may be another retailer's internal code or a discontinued product. Tell the user, then offer to search by name or ask for the model number on the tag.`
      case 'cancelled':
        return 'The user closed the scanner without scanning. Continue naturally — offer to search by name or take a SKU/model number instead.'
      case 'timeout':
        return 'The scan timed out (20s) with nothing scanned. Ask if they want to try again, or offer to search by name / take identifying info (brand, model number).'
      case 'error':
        return `Scanner error: ${outcome.message}. Offer to search by name instead.`
    }
  },
}
