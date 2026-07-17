/**
 * Search-term normalization for Best Buy keyword queries.
 *
 * Every rule here is measured, not assumed (IMA-DOC-4, probed 2026-07-06).
 * Best Buy's `search=` matches PRODUCT NAMES ONLY — not descriptions, not
 * spec details — with all terms ANDed. Recall is therefore hostage to naming
 * conventions:
 *
 * - `search=usbc` → 0 results, but `usb-c` → 32 and `usb c` → 22. Fused
 *   tokens are hard zeros; hyphenated forms recall MORE than split forms.
 * - "65 inch tv" → 8 junk results (warranties, TV-lift cabinets). Names say
 *   `65"` or `65-inch Class`, never the word "inch" — but bare `search=65`
 *   matches both forms (121 clean results in the TVs category).
 * - Including "to" ("usb c TO hdmi adapter") narrows 22 → 15: connector
 *   words in names are inconsistent, so stopwords only shrink recall.
 *
 * Terms are lowercased, deduped, and sorted so semantically equivalent
 * queries ("M4 MacBook Air" / "air macbook m4") produce the same filter and
 * share one cache entry. Order only stops mattering to Best Buy when an
 * explicit `sort` is set — the builder always sets one (see DEFAULT_SORT).
 */

/**
 * Fused-token expansions. `usbc` is a measured hard zero while `usb-c` is
 * the best-recalling form; siblings follow the same naming convention.
 */
const FUSED_ALIASES: Record<string, string> = {
  usbc: 'usb-c',
  usba: 'usb-a',
  typec: 'type-c',
}

/**
 * Words that appear inconsistently in product names. Because terms are
 * ANDed against names only, every stopword kept is a recall cut (measured:
 * "to" alone cost 7 of 22 adapter results).
 */
const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'best',
  'buy',
  'for',
  'in',
  'inch',
  'inches',
  'my',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
])

/**
 * Collapse size/unit suffixes onto the bare number: `65"`, `65in`, `65 inch`,
 * `65-inch` all become `65` (the only form that matches every naming style).
 */
const UNIT_SUFFIX = /(\d+(?:\.\d+)?)\s*(?:"|”|-inch\b|inch(?:es)?\b|in\b)/g

/**
 * Normalize free text into safe, recall-optimized `search=` terms.
 *
 * Output tokens contain only `[a-z0-9.-]`, so they can be embedded in the
 * `/products(...)` filter expression without quoting or encoding — user text
 * can never break out of the grammar.
 */
export function normalizeSearchTerms(query: string): string[] {
  const tokens = query
    .toLowerCase()
    .replace(UNIT_SUFFIX, '$1 ')
    .replace(/[^a-z0-9\s.-]+/g, ' ')
    .split(/\s+/)
    .map((token) => token.replace(/^[.-]+|[.-]+$/g, ''))
    .filter((token) => token.length > 0)
    .map((token) => FUSED_ALIASES[token] ?? token)
    .filter((token) => !STOPWORDS.has(token))
  return [...new Set(tokens)].sort().slice(0, 10)
}
