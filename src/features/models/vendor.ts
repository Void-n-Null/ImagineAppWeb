// Vendor presentation: display names, brand colors, and logo URLs.
//
// models.dev serves monochrome `currentColor` SVG logos at
// https://models.dev/logos/<vendor>.svg keyed by the OpenRouter slug prefix
// (CORS-open, verified 2026-07-05). We tint them with a curated brand-color
// map; vendors outside the map get a deterministic hue so the same vendor is
// always the same color, and every fallback color keeps AA contrast on our
// dark surfaces (lightness/chroma fixed, only hue varies).

export function logoUrl(vendor: string): string {
  return `https://models.dev/logos/${encodeURIComponent(vendor)}.svg`
}

interface VendorMeta {
  name: string
  /** CSS color. Tuned to read on --surface/--raised (dark slate). */
  color: string
}

const VENDOR_META: Record<string, VendorMeta> = {
  openai: { name: 'OpenAI', color: '#5fd4ab' },
  anthropic: { name: 'Anthropic', color: '#e8927c' },
  google: { name: 'Google', color: '#8ab4f8' },
  'meta-llama': { name: 'Meta', color: '#6ba6ff' },
  mistralai: { name: 'Mistral', color: '#ffa94d' },
  qwen: { name: 'Qwen', color: '#a08bff' },
  deepseek: { name: 'DeepSeek', color: '#7a92ff' },
  'x-ai': { name: 'xAI', color: '#c9d4e0' },
  moonshotai: { name: 'Moonshot', color: '#7fd8c8' },
  'z-ai': { name: 'Z.ai', color: '#9db8ff' },
  nvidia: { name: 'NVIDIA', color: '#a3d55d' },
  microsoft: { name: 'Microsoft', color: '#61b8f5' },
  amazon: { name: 'Amazon', color: '#ffb54d' },
  cohere: { name: 'Cohere', color: '#e0a3d0' },
  perplexity: { name: 'Perplexity', color: '#6fc7d4' },
  minimax: { name: 'MiniMax', color: '#ff8fa3' },
  nousresearch: { name: 'Nous Research', color: '#b6a8e8' },
  openrouter: { name: 'OpenRouter', color: '#94a8c4' },
}

export function vendorName(vendor: string): string {
  const meta = VENDOR_META[vendor]
  if (meta) return meta.name
  // "bytedance-seed" → "Bytedance Seed"
  return vendor
    .split('-')
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ')
}

/** Deterministic 32-bit FNV-1a hash — stable colors across sessions. */
function hash(value: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export function vendorColor(vendor: string): string {
  const meta = VENDOR_META[vendor]
  if (meta) return meta.color
  // Fixed lightness/chroma keep unknown-vendor tints legible on dark surfaces.
  return `oklch(0.78 0.1 ${hash(vendor) % 360})`
}
