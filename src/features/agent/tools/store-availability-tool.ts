import { checkStoreAvailability } from '#/server/functions/check-store-availability'
import type { AgentTool } from '../tool'

/**
 * check_store_availability — REAL per-store pickup availability near a zip
 * (IMA-6). This is the Stores API check, unlike the chain-wide
 * inStoreAvailability flag search results carry (IMA-24).
 *
 * v1 fell back to device geolocation; the endpoint only accepts postal
 * codes (verified live 2026-07-05, lat/lng 400s), so the model asks the
 * user for a zip when one wasn't given.
 */
export const storeAvailabilityTool: AgentTool = {
  name: 'check_store_availability',
  description: `Check which Best Buy stores near a ZIP/postal code have a product in stock for pickup, sorted by distance.
Requires the SKU and a postal code — ask the user for their ZIP if you don't have one.
Caveats to relay: "in stock" data can lag reality, so frame positives as "showing in stock as of now — worth verifying"; "out of stock" is reliable.`,
  parameters: {
    type: 'object',
    properties: {
      sku: {
        type: 'integer',
        description: 'Best Buy SKU number of the product.',
      },
      postal_code: {
        type: 'string',
        description: 'ZIP or postal code to search near, e.g. "55423".',
      },
    },
    required: ['sku', 'postal_code'],
  },
  statusLabel() {
    return 'Checking nearby stores'
  },
  async execute(args) {
    const sku =
      typeof args.sku === 'number' && Number.isSafeInteger(args.sku)
        ? args.sku
        : undefined
    const postalCode =
      typeof args.postal_code === 'string' ||
      typeof args.postal_code === 'number'
        ? String(args.postal_code).trim()
        : ''
    if (sku === undefined) return 'Error: sku is required (integer).'
    if (postalCode.length < 3) {
      return 'Error: postal_code is required. Ask the user for their ZIP code.'
    }

    const result = await checkStoreAvailability({
      data: { sku, postalCode },
    })
    if (result.status === 'error') {
      return `Store check failed: ${result.message}`
    }

    const { page } = result
    if (page.stores.length === 0) {
      return `No stores near ${postalCode} show SKU ${sku} in stock for pickup. It may be online-only, out of stock nearby, or not carried in stores. (Out-of-stock readings are reliable.)`
    }

    const lines = [
      `${page.stores.length} store${page.stores.length === 1 ? '' : 's'} near ${postalCode} show SKU ${sku} available${page.ispuEligible ? ' (pickup eligible)' : ''}:`,
      '',
    ]
    page.stores.forEach((store, i) => {
      const parts: string[] = []
      const place = [store.city, store.state].filter(Boolean).join(', ')
      if (place) parts.push(place)
      if (store.distance !== null) parts.push(`${store.distance.toFixed(1)} mi`)
      if (store.lowStock) parts.push('LOW STOCK')
      if (store.minPickupHours !== null) {
        parts.push(
          store.minPickupHours < 1
            ? 'pickup ready fast'
            : `pickup in ~${store.minPickupHours}h`,
        )
      }
      lines.push(
        `${i + 1}. ${store.name ?? `Store #${store.storeId}`} | ${parts.join(' | ')}`,
      )
    })
    lines.push(
      '',
      'Stock data may lag reality — frame positives as "showing in stock, worth verifying".',
    )
    return lines.join('\n')
  },
}
