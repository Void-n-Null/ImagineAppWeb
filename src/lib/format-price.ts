/** "$399" / "$399.99" — whole dollars drop the cents (shelf-tag style). */
export function formatPrice(price: number): string {
  return price % 1 === 0 ? `$${price.toFixed(0)}` : `$${price.toFixed(2)}`
}
