import { formatPrice } from '#/lib/format-price'
import type { BestBuyProduct } from '#/server/bestbuy/types'

/**
 * Customer quote text (IMA-29) — what an employee pastes into a text
 * message or quote notes when the customer says "can you send me that?".
 * Plain text, no markdown (it's going into SMS), identifiers the customer
 * can hand to ANY employee later: name, model, SKU, price as of today.
 */
export function buildCustomerQuote(product: BestBuyProduct): string {
  const lines: string[] = [product.name]

  const price = product.salePrice ?? product.regularPrice
  if (price !== null) {
    const saving =
      product.onSale && product.regularPrice !== null
        ? product.regularPrice - price
        : 0
    lines.push(
      saving > 0 && product.regularPrice !== null
        ? `${formatPrice(price)} (reg. ${formatPrice(product.regularPrice)} — save ${formatPrice(saving)})`
        : formatPrice(price),
    )
  }

  const identifiers = [
    `SKU ${product.sku}`,
    product.modelNumber !== null ? `Model ${product.modelNumber}` : null,
  ].filter(Boolean)
  lines.push(identifiers.join(' · '))

  // Chain-wide catalog flags only — never per-store stock claims (IMA-24).
  const availability = [
    product.inStoreAvailability === true ? 'Sold in stores' : null,
    product.onlineAvailability === true ? 'Available online' : null,
  ].filter(Boolean)
  if (availability.length > 0) lines.push(availability.join(' · '))

  if (product.url !== null) lines.push(product.url)

  return lines.join('\n')
}
