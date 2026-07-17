import type { BenchQuestion } from '../checks'

/**
 * search × hard — questions whose constraints only resolve after the model
 * combines multiple filters, pages through results, and/or reads several
 * candidates' specs. Every answer was verified to converge on ONE SKU (or a
 * tight tolerance set of finish/color variants) against the live Best Buy
 * catalog on 2026-07-08 via `scripts/bench/tool-cli.ts`.
 *
 * A trivial single-search question is a medium; each of these was checked to
 * ensure a naive search does NOT hand the model the answer — it must filter on
 * a spec that lives among a candidate set (RAM, storage, refresh rate,
 * capacity, Wi-Fi-vs-cellular, tier) that popularity sort does not surface
 * first.
 */
export const SEARCH_HARD: BenchQuestion[] = [
  {
    id: 'search-hard-1',
    concept: 'search',
    difficulty: 'hard',
    prompt:
      "Customer wants a top-end gaming/creator laptop: it has to have an RTX 5090, 64GB of RAM, and a 4TB SSD. Anything in the catalog fit all three?",
    check: { kind: 'sku', skus: [6646768] },
    notes:
      'Verified 2026-07-08. search_products {"query":"RTX 5090","category":"Laptops","limit":20} returns 6 RTX 5090 laptops: ' +
      '6646768 (ASUS ProArt P16, 64GB, 4TB SSD), 6632084 (Strix SCAR 16, 32GB, 2TB), 6623751 (AORUS MASTER 18, 64GB, 2TB), ' +
      '6629711 (Zephyrus G16, 64GB, 2TB), 6624251 (AORUS MASTER 16, 32GB, 2TB), 6621620 (MSI 18", 64GB, 2TB). ' +
      'The RAM≥64GB filter keeps {6646768, 6623751, 6629711, 6621620}; the SSD=4TB filter removes all but 6646768 (every ' +
      'other candidate is 2TB). analyze_product {"sku":6646768} confirms "64GB Memory - RTX 5090 - 4TB SSD" (model H7606WX-XH99T). ' +
      'Hard because the model must run the GPU search, then read storage AND memory across 6 candidates to isolate the one that ' +
      'satisfies both spec floors — a single query cannot express "4TB". Unique answer.',
  },
  {
    id: 'search-hard-2',
    concept: 'search',
    difficulty: 'hard',
    prompt:
      "I want the least-expensive 77-inch OLED TV you carry, and it has to be an LG. Which one is it?",
    check: { kind: 'sku', skus: [6621813] },
    notes:
      'Verified 2026-07-08. search_products {"query":"OLED","category":"TVs","manufacturer":"LG","screen_size_min":76,' +
      '"screen_size_max":78,"sort_by":"price_low","limit":15} returns 10 LG 77" OLEDs, cheapest-first: ' +
      '6621813 (77" B5, $1499.99) then 6621825 (77" C5, $2199.99) — a ~$700 gap, no near-tie. The B-series is LG\'s entry OLED ' +
      'tier, so 6621813 is structurally the cheapest 77" LG OLED even independent of the current sale (its regular price 2999.99 ' +
      'is at/below every other 77" model\'s regular price). Hard because the model must pick BOTH the right filters (brand + ' +
      'screen_size range, NOT the size in the query) AND price_low sort; using a size token in the query name-search fails. ' +
      'Check is the SKU, not the price, so a sale rollover does not invalidate it. Unique answer.',
  },
  {
    id: 'search-hard-3',
    concept: 'search',
    difficulty: 'hard',
    prompt:
      "A competitive gamer wants the Samsung Odyssey OLED monitor with the highest refresh rate you stock. Which model is that?",
    check: { kind: 'sku', skus: [6635360] },
    notes:
      'Verified 2026-07-08. search_products {"query":"Odyssey OLED","limit":20} returns all 14 Odyssey OLED monitors. Sorting by ' +
      'refresh rate read from names: 6635360 (27" G6 G60SF, 500Hz) is the single fastest; runner-up 6573684 (27" G6 G60SD, 360Hz); ' +
      'everything else is ≤240Hz. No other Odyssey OLED lists 500Hz, and non-OLED Odysseys top out at 240Hz (verified via ' +
      '{"query":"Odyssey","limit":15} pages). Hard because 6635360 has only 51 reviews and does NOT appear on page 1 of the ' +
      'popularity-sorted default results — the model must enumerate the OLED lineup and compare the refresh spec across all of ' +
      'them rather than take the first hit. Unique answer.',
  },
  {
    id: 'search-hard-4',
    concept: 'search',
    difficulty: 'hard',
    prompt:
      "For a big family — what's the largest-capacity LG French door refrigerator you carry? I mean the most cubic feet.",
    check: { kind: 'sku', skus: [6553174, 6617561] },
    notes:
      'Verified 2026-07-08. search_products {"query":"refrigerator french door","category":"Refrigerators","manufacturer":"LG"} ' +
      'returns 48 results across 4 pages. Scanning the cubic-foot figure in every name, the maximum is 31.7 Cu. Ft., shared by ' +
      'exactly two models: 6553174 (LRFLS3206S) and 6617561 (LRFLS3216S), both 36" Standard-Depth MAX Stainless Steel, confirmed ' +
      'via analyze_product. Next-largest are 30.7 (several) and 29.6 — a clear 1.0+ cu ft gap below the tied leaders. Two SKUs are ' +
      'listed as tolerance (they are near-identical model revisions at the same max capacity); either is a correct answer. Hard ' +
      'because the model must page through all 48 candidates and compare an in-name numeric to find the maximum — no sort exposes ' +
      '"largest capacity" directly.',
  },
  {
    id: 'search-hard-5',
    concept: 'search',
    difficulty: 'hard',
    prompt:
      "Customer specifically wants the 13-inch iPad Pro with the M5 chip, 512GB of storage, Wi-Fi only (no cellular). Which SKU is that?",
    check: { kind: 'sku', skus: [6586885, 6586883] },
    notes:
      'Verified 2026-07-08. search_products {"query":"13-inch iPad Pro M5 512GB","category":"Tablets","limit":20} returns 8 ' +
      'matching 512GB variants. Only two are Wi-Fi-only: 6586885 (Silver) and 6586883 (Space Black), both $1699. The other six are ' +
      'Wi-Fi + Cellular (Unlocked/AT&T/Verizon) at $1899–$1899.99. The two Wi-Fi SKUs are color variants of one config, listed as ' +
      'tolerance. Hard because the Tablets category has 146 products and the model must isolate BOTH the 13" size and the 512GB ' +
      'tier AND correctly reject the cellular variants that otherwise match every keyword — the Wi-Fi-vs-cellular distinction is ' +
      'the load-bearing filter. Tight two-SKU answer.',
  },
  {
    id: 'search-hard-6',
    concept: 'search',
    difficulty: 'hard',
    prompt:
      "Which is Sony's newest flagship over-ear noise-cancelling headphone in the 1000X line — the one that's rated higher than the XM5?",
    check: {
      kind: 'anyOf',
      checks: [{ kind: 'sku', skus: [6620466, 6620467, 6620462, 6667487] }],
    },
    notes:
      'Verified 2026-07-08. search_products {"query":"noise cancelling headphones","category":"Headphones","manufacturer":"Sony"} ' +
      'lists the over-ear 1000X lineup: WH-1000XM6 (newest, 4.7/5, 1224 reviews) in four color SKUs — 6620466 (Silver), 6620467 ' +
      '(Black), 6620462 (Midnight Blue), 6667487 (Sand Pink) — vs the older WH-1000XM5 (4.6/5, 6399 reviews across 4 colors). The ' +
      'XM6 is both the newest 1000X over-ear model AND the higher-rated (4.7 vs 4.6, a stable gap on 1000+ reviews). Because the ' +
      'answer is a single product sold as 4 color SKUs, all four are accepted via anyOf/sku. Hard because the XM5 dominates the ' +
      'popularity sort (top of results by review volume) and the WHCH720N / WF-1000XM5 also match the keyword search — the model ' +
      'must scan the lineup and reason over generation + rating to pick the XM6 rather than the most-reviewed hit.',
  },
]
